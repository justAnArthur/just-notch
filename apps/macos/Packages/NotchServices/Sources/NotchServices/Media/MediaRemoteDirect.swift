import Foundation

/// MediaRemote called from this process. Works up to macOS 15.3; from 15.4 the
/// daemon answers non-Apple processes with empty info, which `probe` detects.
@MainActor
final class MediaRemoteDirect: MediaBackend {
    let name = "MediaRemote (in-process)"
    var onChange: ((RawNowPlaying?) -> Void)?
    var onFailure: (() -> Void)?

    private typealias Register = @convention(c) (DispatchQueue) -> Void
    private typealias Unregister = @convention(c) () -> Void
    private typealias GetInfo = @convention(c) (DispatchQueue, @escaping @convention(block) (CFDictionary?) -> Void) -> Void
    private typealias GetPlaying = @convention(c) (DispatchQueue, @escaping @convention(block) (DarwinBoolean) -> Void) -> Void
    private typealias GetClient = @convention(c) (DispatchQueue, @escaping @convention(block) (AnyObject?) -> Void) -> Void
    private typealias ClientBundle = @convention(c) (AnyObject) -> Unmanaged<CFString>?
    private typealias SendCommand = @convention(c) (Int32, CFDictionary?) -> DarwinBoolean
    private typealias SetElapsed = @convention(c) (Double) -> Void

    private struct API {
        let register: Register
        let unregister: Unregister?
        let getInfo: GetInfo
        let getPlaying: GetPlaying
        let getClient: GetClient?
        let clientBundle: ClientBundle?
        let send: SendCommand
        let setElapsed: SetElapsed?
    }

    private static let api: API? = {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_LAZY) else { return nil }
        func load<T>(_ name: String, as type: T.Type) -> T? {
            dlsym(handle, name).map { unsafeBitCast($0, to: type) }
        }
        guard let register = load("MRMediaRemoteRegisterForNowPlayingNotifications", as: Register.self),
              let getInfo = load("MRMediaRemoteGetNowPlayingInfo", as: GetInfo.self),
              let getPlaying = load("MRMediaRemoteGetNowPlayingApplicationIsPlaying", as: GetPlaying.self),
              let send = load("MRMediaRemoteSendCommand", as: SendCommand.self) else { return nil }
        return API(
            register: register,
            unregister: load("MRMediaRemoteUnregisterForNowPlayingNotifications", as: Unregister.self),
            getInfo: getInfo,
            getPlaying: getPlaying,
            getClient: load("MRMediaRemoteGetNowPlayingClient", as: GetClient.self),
            clientBundle: load("MRNowPlayingClientGetBundleIdentifier", as: ClientBundle.self),
            send: send,
            setElapsed: load("MRMediaRemoteSetElapsedTime", as: SetElapsed.self)
        )
    }()

    private static let notifications = [
        "kMRMediaRemoteNowPlayingInfoDidChangeNotification",
        "kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification",
        "kMRMediaRemoteNowPlayingApplicationDidChangeNotification",
    ]

    private var observers: [NSObjectProtocol] = []
    private var refreshPending = false

    /// Whether MediaRemote answers this process with real now-playing info.
    static func probe(timeout: TimeInterval = 1) async -> Bool {
        guard let api else { return false }
        return await withCheckedContinuation { continuation in
            let once = Once()
            api.getInfo(.main) { info in
                let count = (info as NSDictionary?)?.count ?? 0
                once.run { continuation.resume(returning: count > 0) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
                once.run { continuation.resume(returning: false) }
            }
        }
    }

    static var available: Bool { api != nil }

    func start() {
        guard let api = Self.api else {
            onFailure?()
            return
        }
        api.register(.main)
        observers = Self.notifications.map { name in
            NotificationCenter.default.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.scheduleRefresh() }
            }
        }
        refresh()
    }

    func stop() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        Self.api?.unregister?()
    }

    func send(_ command: MediaCommand) {
        guard let api = Self.api else { return }
        switch command {
        case .play: _ = api.send(0, nil)
        case .pause: _ = api.send(1, nil)
        case .toggle: _ = api.send(2, nil)
        case .next: _ = api.send(4, nil)
        case .previous: _ = api.send(5, nil)
        case .seek(let position): api.setElapsed?(position)
        case .shuffle, .repeat, .like:
            guard let (code, options) = MediaRemoteMode.options(command) else { return }
            _ = api.send(code, options as CFDictionary)
        }
        scheduleRefresh()
    }

    private func scheduleRefresh() {
        guard !refreshPending else { return }
        refreshPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
            MainActor.assumeIsolated {
                self?.refreshPending = false
                self?.refresh()
            }
        }
    }

    private func refresh() {
        guard let api = Self.api else { return }
        api.getInfo(.main) { [weak self] info in
            let info = (info as NSDictionary?) as? [String: Any] ?? [:]
            api.getPlaying(.main) { playing in
                guard let getClient = api.getClient, let clientBundle = api.clientBundle else {
                    MainActor.assumeIsolated { self?.deliver(info, playing: playing.boolValue, bundleId: nil) }
                    return
                }
                getClient(.main) { client in
                    let bundleId = client.flatMap { clientBundle($0)?.takeUnretainedValue() as String? }
                    MainActor.assumeIsolated { self?.deliver(info, playing: playing.boolValue, bundleId: bundleId) }
                }
            }
        }
    }

    private func deliver(_ info: [String: Any], playing: Bool, bundleId: String?) {
        guard !observers.isEmpty else { return }
        onChange?(Self.parse(info, playing: playing, bundleId: bundleId))
    }

    static func parse(_ info: [String: Any], playing: Bool, bundleId: String?) -> RawNowPlaying? {
        guard !info.isEmpty else { return nil }
        func string(_ key: String) -> String { info["kMRMediaRemoteNowPlayingInfo\(key)"] as? String ?? "" }
        func number(_ key: String) -> Double { (info["kMRMediaRemoteNowPlayingInfo\(key)"] as? NSNumber)?.doubleValue ?? 0 }
        let date = info["kMRMediaRemoteNowPlayingInfoTimestamp"] as? Date ?? Date()
        let artwork = info["kMRMediaRemoteNowPlayingInfoArtworkData"] as? Data
        func optional(_ key: String) -> NSNumber? { info["kMRMediaRemoteNowPlayingInfo\(key)"] as? NSNumber }
        return RawNowPlaying(
            title: string("Title"),
            artist: string("Artist"),
            album: string("Album"),
            durationS: number("Duration"),
            positionS: number("ElapsedTime"),
            rate: number("PlaybackRate"),
            playing: playing,
            timestamp: (date.timeIntervalSince1970 * 1000).rounded(),
            bundleId: bundleId,
            artwork: artwork,
            artworkCleared: artwork == nil,
            shuffleMode: optional("ShuffleMode")?.intValue,
            repeatMode: optional("RepeatMode")?.intValue,
            isLiked: optional("IsLiked")?.boolValue,
            supportsIsLiked: optional("SupportsIsLiked")?.boolValue
        )
    }
}

/// Runs its closure at most once, from any thread.
final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func run(_ body: () -> Void) {
        lock.lock()
        let first = !done
        done = true
        lock.unlock()
        if first { body() }
    }
}
