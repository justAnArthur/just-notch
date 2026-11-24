import Foundation
import os

let mediaLog = Logger(subsystem: "just-notch", category: "media")

/// `media` topic and `media.command`. Picks a backend at start, in order:
/// MediaRemote in-process (if it actually returns data), the perl bridge
/// (macOS 15.4+), then AppleScript polling of Music and Spotify.
/// `media.command` works without a subscriber: it picks a backend on demand
/// and stops it after a minute without commands.
@MainActor
public final class MediaService: NotchService {
    public let topics = ["media"]
    public let methods = ["media.command"]
    public weak var sink: ServiceSink?

    /// Name of the backend in use, for logs and diagnostics.
    public private(set) var activeBackend: String?

    private var backend: MediaBackend?
    private var running = false
    private var generation = 0
    private var state: MediaState?
    private var known = false
    private var artworkData: Data?
    private var artworkUrl: String?
    /// The track the current artwork belongs to.
    private var artworkTrack: String?
    private var latest = Latest<MediaState?>()
    /// The state as the backend reported it, before `modes` fills in what it left out.
    private var reported: MediaState?
    private let modes = AppleEventModePoller()
    /// Drops a "playing" track once it should have ended: see `RawNowPlaying.staleAt`.
    private var staleCheck: Timer?

    private static let idleTimeout: TimeInterval = 60
    private let picker: @MainActor (Set<String>) async -> MediaBackend
    private var onDemand: Task<MediaBackend, Never>?
    private var idleStop: Timer?

    public convenience init() {
        self.init { await MediaService.pick(skipping: $0) }
    }

    init(picker: @escaping @MainActor (Set<String>) async -> MediaBackend) {
        self.picker = picker
        modes.onChange = { [weak self] _ in
            guard let self, let reported = self.reported else { return }
            self.publish(self.filled(reported))
        }
    }

    public func start(topic: String) {
        guard !running else { return }
        running = true
        select(skipping: [])
    }

    public func stop(topic: String) {
        guard running else { return }
        running = false
        generation += 1
        backend?.stop()
        backend = nil
        activeBackend = nil
        state = nil
        known = false
        artworkData = nil
        artworkUrl = nil
        latest.reset()
        reported = nil
        staleCheck?.invalidate()
        staleCheck = nil
        modes.watch(nil)
    }

    public func snapshot(topic: String) async -> Data? {
        guard known else { return nil }
        return state.json() ?? jsonNull
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "media.command" else { throw ServiceError("unknown method \(method)") }
        let command = try decode(MediaCommand.self, params)
        if let reported, scriptsModes(command, reported) {
            modes.send(command)
            return nil
        }
        let target = if let backend { backend } else { await commandBackend() }
        target.send(command)
        return nil
    }

    private func commandBackend() async -> MediaBackend {
        let task = onDemand ?? Task { await picker([]) }
        onDemand = task
        let chosen = await task.value
        guard onDemand == task else { return backend ?? chosen }
        chosen.onFailure = { [weak self] in self?.dropOnDemand() }
        idleStop?.invalidate()
        idleStop = Timer.scheduledTimer(withTimeInterval: Self.idleTimeout, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.dropOnDemand() }
        }
        return chosen
    }

    private func dropOnDemand() {
        idleStop?.invalidate()
        idleStop = nil
        guard let task = onDemand else { return }
        onDemand = nil
        Task { await task.value.stop() }
    }

    private func select(skipping failed: Set<String>) {
        generation += 1
        let current = generation
        Task { @MainActor in
            let chosen = await self.picker(failed)
            guard self.running, self.generation == current else { return chosen.stop() }
            self.use(chosen, skipping: failed)
        }
    }

    private static func pick(skipping failed: Set<String>) async -> MediaBackend {
        let direct = MediaRemoteDirect()
        if !failed.contains(direct.name), MediaRemoteDirect.available {
            let restricted = ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 15, minorVersion: 4, patchVersion: 0))
            if !restricted { return direct }
            if await MediaRemoteDirect.probe() { return direct }
        }

        if let bridge = MediaBridgeBackend(), !failed.contains(bridge.name) {
            if await bridge.launch() { return bridge }
            bridge.stop()
            mediaLog.error("media bridge failed to start")
        }
        return AppleScriptBackend()
    }

    private func use(_ chosen: MediaBackend, skipping failed: Set<String>) {
        dropOnDemand()
        backend = chosen
        activeBackend = chosen.name
        mediaLog.info("media backend: \(chosen.name, privacy: .public)")
        chosen.onChange = { [weak self] raw in self?.receive(raw) }
        chosen.onFailure = { [weak self, weak chosen] in
            guard let self, let chosen, self.running, self.backend === chosen else { return }
            mediaLog.error("media backend failed: \(chosen.name, privacy: .public)")
            self.backend = nil
            self.select(skipping: failed.union([chosen.name]))
        }
        chosen.start()
    }

    private func receive(_ raw: RawNowPlaying?) {
        known = true
        staleCheck?.invalidate()
        staleCheck = nil
        var raw = raw
        if let staleAt = raw?.staleAt {
            if staleAt <= Date() {
                mediaLog.info("dropping stale now playing from \(raw?.bundleId ?? "?", privacy: .public)")
                raw = nil
            } else {
                let held = raw
                staleCheck = Timer.scheduledTimer(withTimeInterval: staleAt.timeIntervalSinceNow, repeats: false) { [weak self] _ in
                    MainActor.assumeIsolated { self?.receive(held) }
                }
            }
        }
        guard let raw else {
            artworkData = nil
            artworkUrl = nil
            artworkTrack = nil
            reported = nil
            modes.watch(nil)
            return publish(nil)
        }

        // Players send updates without artwork for the same track (play/pause, a seek, before the art
        // loads): only a different track may clear it, or the artwork blinks out on every update. A track
        // is its app and title: browsers fill in the artist and album a moment later.
        let track = [raw.bundleId ?? "", raw.title].joined(separator: "\u{1F}")
        if raw.artwork != nil || (raw.artworkCleared == true && artworkUrl != nil) {
            mediaLog.debug("artwork \(raw.artwork != nil ? "new" : "absent", privacy: .public) for \(raw.title, privacy: .public) (\(track == self.artworkTrack ? "same" : "new", privacy: .public) track)")
        }
        if let artwork = raw.artwork {
            artworkTrack = track
            if artwork != artworkData {
                artworkData = artwork
                artworkUrl = artworkDataURL(artwork)
            }
        } else if raw.artworkCleared == true, track != artworkTrack {
            artworkTrack = nil
            artworkData = nil
            artworkUrl = nil
        }

        let state = MediaState(
            playing: raw.playing,
            title: raw.title,
            artist: raw.artist,
            album: raw.album,
            artworkUrl: artworkUrl,
            durationS: raw.durationS,
            positionS: raw.positionS,
            rate: raw.playing ? raw.rate : 0,
            updatedAt: raw.timestamp,
            sourceApp: raw.bundleId,
            shuffle: MediaRemoteMode.shuffle(raw.shuffleMode),
            repeat: MediaRemoteMode.repeat(raw.repeatMode),
            liked: MediaRemoteMode.liked(raw.isLiked, supported: raw.supportsIsLiked)
        )
        reported = state
        let missing = state.shuffle == nil || state.repeat == nil || (state.liked == nil && raw.bundleId == AppleEventModes.music)
        modes.watch(missing ? raw.bundleId : nil)
        publish(filled(state))
    }

    /// Fills in what the backend left out from the player's own Apple Events.
    private func filled(_ state: MediaState) -> MediaState {
        guard let read = modes.modes, modes.bundleId == state.sourceApp else { return state }
        var state = state
        if state.shuffle == nil { state.shuffle = read.shuffle }
        if state.repeat == nil {
            state.repeat = read.repeat
            state.repeatModes = read.repeatModes
        }
        if state.liked == nil { state.liked = read.liked }
        return state
    }

    /// The command changes a mode that came from Apple Events.
    private func scriptsModes(_ command: MediaCommand, _ reported: MediaState) -> Bool {
        guard let read = modes.modes, modes.bundleId == reported.sourceApp else { return false }
        return switch command {
        case .shuffle: reported.shuffle == nil && read.shuffle != nil
        case .repeat: reported.repeat == nil && read.repeat != nil
        case .like: reported.liked == nil && read.liked != nil
        default: false
        }
    }

    private func publish(_ new: MediaState?) {
        if let new, let old = latest.value ?? nil, new.continues(old) { return }
        state = new
        guard latest.update(new) else { return }
        sink?.publish(topic: "media", value: new.json() ?? jsonNull)
    }
}

extension MediaState {
    /// Same track and playback, with a position the web would have extrapolated
    /// anyway: not worth a publish.
    func continues(_ old: MediaState, tolerance: Double = 1.5) -> Bool {
        guard playing == old.playing, rate == old.rate, title == old.title, artist == old.artist, album == old.album,
              artworkUrl == old.artworkUrl, durationS == old.durationS, sourceApp == old.sourceApp,
              shuffle == old.shuffle, self.repeat == old.repeat, repeatModes == old.repeatModes, liked == old.liked else { return false }
        let expected = old.positionS + (updatedAt - old.updatedAt) / 1000 * old.rate
        return abs(expected - positionS) < tolerance
    }
}
