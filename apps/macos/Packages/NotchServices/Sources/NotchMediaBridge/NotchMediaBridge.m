#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import "NotchMediaBridge.h"

typedef void (*RegisterFn)(dispatch_queue_t);
typedef void (*GetInfoFn)(dispatch_queue_t, void (^)(CFDictionaryRef));
typedef void (*GetPlayingFn)(dispatch_queue_t, void (^)(Boolean));
typedef void (*GetClientFn)(dispatch_queue_t, void (^)(id));
typedef CFStringRef (*ClientBundleFn)(id);
typedef Boolean (*SendCommandFn)(int, CFDictionaryRef);
typedef void (*SetElapsedFn)(double);

static RegisterFn registerForNotifications;
static GetInfoFn getInfo;
static GetPlayingFn getPlaying;
static GetClientFn getClient;
static ClientBundleFn clientBundle;
static ClientBundleFn clientParentBundle;
static SendCommandFn sendCommand;
static SetElapsedFn setElapsed;

static dispatch_queue_t queue;
static NSData *lastArtwork;
static BOOL refreshPending;

static NSString *infoString(NSDictionary *info, NSString *key) {
    id value = info[key];
    return [value isKindOfClass:NSString.class] ? value : @"";
}

static double infoNumber(NSDictionary *info, NSString *key) {
    id value = info[key];
    return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0;
}

static void writeLine(NSDictionary *message) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
    if (!data) return;
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static void emit(NSDictionary *info, BOOL playing, NSString *bundleId) {
    if (info.count == 0) {
        lastArtwork = nil;
        writeLine(@{ @"type": @"state", @"info": NSNull.null });
        return;
    }

    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    out[@"title"] = infoString(info, @"kMRMediaRemoteNowPlayingInfoTitle");
    out[@"artist"] = infoString(info, @"kMRMediaRemoteNowPlayingInfoArtist");
    out[@"album"] = infoString(info, @"kMRMediaRemoteNowPlayingInfoAlbum");
    out[@"durationS"] = @(infoNumber(info, @"kMRMediaRemoteNowPlayingInfoDuration"));
    out[@"positionS"] = @(infoNumber(info, @"kMRMediaRemoteNowPlayingInfoElapsedTime"));
    out[@"rate"] = @(infoNumber(info, @"kMRMediaRemoteNowPlayingInfoPlaybackRate"));
    out[@"playing"] = @(playing);
    if (bundleId.length) out[@"bundleId"] = bundleId;

    id timestamp = info[@"kMRMediaRemoteNowPlayingInfoTimestamp"];
    NSDate *date = [timestamp isKindOfClass:NSDate.class] ? timestamp : [NSDate date];
    out[@"timestamp"] = @((long long)(date.timeIntervalSince1970 * 1000));

    // Left out when the player doesn't report them, so the island hides their toggles.
    NSDictionary *optional = @{
        @"shuffleMode": @"kMRMediaRemoteNowPlayingInfoShuffleMode",
        @"repeatMode": @"kMRMediaRemoteNowPlayingInfoRepeatMode",
        @"isLiked": @"kMRMediaRemoteNowPlayingInfoIsLiked",
        @"supportsIsLiked": @"kMRMediaRemoteNowPlayingInfoSupportsIsLiked",
    };
    for (NSString *field in optional) {
        id value = info[optional[field]];
        if ([value isKindOfClass:NSNumber.class]) out[field] = value;
    }

    id artwork = info[@"kMRMediaRemoteNowPlayingInfoArtworkData"];
    if ([artwork isKindOfClass:NSData.class] && [artwork length] > 0) {
        // Artwork only travels when it changed; the reader keeps the last one.
        if (![artwork isEqualToData:lastArtwork]) {
            lastArtwork = artwork;
            out[@"artwork"] = [artwork base64EncodedStringWithOptions:0];
        }
    } else {
        lastArtwork = nil;
        out[@"artworkCleared"] = @YES;
    }

    writeLine(@{ @"type": @"state", @"info": out });
}

static void refresh(void) {
    getInfo(queue, ^(CFDictionaryRef infoRef) {
        NSDictionary *info = [(__bridge NSDictionary *)infoRef copy];
        getPlaying(queue, ^(Boolean playing) {
            if (!getClient || !clientBundle) {
                emit(info, playing, nil);
                return;
            }
            getClient(queue, ^(id client) {
                NSString *bundleId = nil;
                if (client) {
                    if (clientParentBundle) bundleId = (__bridge NSString *)clientParentBundle(client);
                    if (!bundleId.length) bundleId = (__bridge NSString *)clientBundle(client);
                }
                emit(info, playing, bundleId);
            });
        });
    });
}

static void scheduleRefresh(void) {
    if (refreshPending) return;
    refreshPending = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 80 * NSEC_PER_MSEC), queue, ^{
        refreshPending = NO;
        refresh();
    });
}

static void runCommand(NSString *line) {
    NSArray<NSString *> *parts = [line componentsSeparatedByString:@" "];
    NSString *name = parts.firstObject;
    NSDictionary<NSString *, NSNumber *> *codes = @{ @"play": @0, @"pause": @1, @"toggle": @2, @"next": @4, @"previous": @5 };

    // MRMediaRemoteSendCommand codes and option keys, as MRMediaRemoteCopyCommandDescription names them on macOS 26:
    // 21 LikeTrack, 25 SetRepeatMode, 26 SetShuffleMode.
    if ([name isEqualToString:@"seek"] && parts.count > 1) {
        if (setElapsed) setElapsed(parts[1].doubleValue);
    } else if ([name isEqualToString:@"shuffle"] && parts.count > 1) {
        sendCommand(26, (__bridge CFDictionaryRef)@{ @"kMRMediaRemoteOptionShuffleMode": @(parts[1].intValue) });
    } else if ([name isEqualToString:@"repeat"] && parts.count > 1) {
        sendCommand(25, (__bridge CFDictionaryRef)@{ @"kMRMediaRemoteOptionRepeatMode": @(parts[1].intValue) });
    } else if ([name isEqualToString:@"like"] && parts.count > 1) {
        sendCommand(21, (__bridge CFDictionaryRef)@{ @"kMRMediaRemoteOptionIsNegative": @(parts[1].intValue == 0) });
    } else if (codes[name]) {
        sendCommand(codes[name].intValue, NULL);
    }
    scheduleRefresh();
}

static void *symbol(void *handle, const char *name) {
    void *sym = dlsym(handle, name);
    if (!sym) writeLine(@{ @"type": @"warning", @"message": [NSString stringWithFormat:@"missing %s", name] });
    return sym;
}

void notch_media_bridge_run(void *perl, void *cv) {
    (void)perl;
    (void)cv;

    void *handle = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW);
    if (!handle) {
        writeLine(@{ @"type": @"error", @"message": @"MediaRemote not loadable" });
        exit(1);
    }
    registerForNotifications = symbol(handle, "MRMediaRemoteRegisterForNowPlayingNotifications");
    getInfo = symbol(handle, "MRMediaRemoteGetNowPlayingInfo");
    getPlaying = symbol(handle, "MRMediaRemoteGetNowPlayingApplicationIsPlaying");
    sendCommand = symbol(handle, "MRMediaRemoteSendCommand");
    setElapsed = symbol(handle, "MRMediaRemoteSetElapsedTime");
    getClient = symbol(handle, "MRMediaRemoteGetNowPlayingClient");
    clientBundle = symbol(handle, "MRNowPlayingClientGetBundleIdentifier");
    clientParentBundle = dlsym(handle, "MRNowPlayingClientGetParentAppBundleIdentifier");
    if (!registerForNotifications || !getInfo || !getPlaying || !sendCommand) {
        writeLine(@{ @"type": @"error", @"message": @"MediaRemote symbols missing" });
        exit(1);
    }

    queue = dispatch_queue_create("notch.media.bridge", DISPATCH_QUEUE_SERIAL);
    registerForNotifications(queue);

    NSArray *names = @[
        @"kMRMediaRemoteNowPlayingInfoDidChangeNotification",
        @"kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification",
        @"kMRMediaRemoteNowPlayingApplicationDidChangeNotification",
        @"kMRMediaRemotePlaybackStateDidChangeNotification",
    ];
    for (NSString *name in names) {
        [NSNotificationCenter.defaultCenter addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) {
            (void)note;
            dispatch_async(queue, ^{ scheduleRefresh(); });
        }];
    }

    writeLine(@{ @"type": @"ready" });
    dispatch_async(queue, ^{ refresh(); });

    [NSThread detachNewThreadWithBlock:^{
        char buffer[512];
        while (fgets(buffer, sizeof buffer, stdin)) {
            NSString *line = [[NSString stringWithUTF8String:buffer] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            if (line.length) dispatch_async(queue, ^{ runCommand(line); });
        }
        exit(0);
    }];

    CFRunLoopRun();
    exit(0);
}
