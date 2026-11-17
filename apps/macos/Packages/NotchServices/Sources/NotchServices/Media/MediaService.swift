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

    private static let idleTimeout: TimeInterval = 60
    private let picker: @MainActor (Set<String>) async -> MediaBackend
    private var onDemand: Task<MediaBackend, Never>?
    private var idleStop: Timer?

    public convenience init() {
        self.init { await MediaService.pick(skipping: $0) }
    }

    init(picker: @escaping @MainActor (Set<String>) async -> MediaBackend) {
        self.picker = picker
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
    }

    public func snapshot(topic: String) async -> Data? {
        guard known else { return nil }
        return state.json() ?? jsonNull
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "media.command" else { throw ServiceError("unknown method \(method)") }
        let command = try decode(MediaCommand.self, params)
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
        guard let raw else {
            artworkData = nil
            artworkUrl = nil
            artworkTrack = nil
            return publish(nil)
        }

        // Players send updates without artwork for the same track (play/pause, a seek, before the art
        // loads): only a different track may clear it, or the artwork blinks out on every update.
        let track = [raw.title, raw.artist, raw.album].joined(separator: "\u{1F}")
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

        publish(MediaState(
            playing: raw.playing,
            title: raw.title,
            artist: raw.artist,
            album: raw.album,
            artworkUrl: artworkUrl,
            durationS: raw.durationS,
            positionS: raw.positionS,
            rate: raw.playing ? raw.rate : 0,
            updatedAt: raw.timestamp,
            sourceApp: raw.bundleId
        ))
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
              artworkUrl == old.artworkUrl, durationS == old.durationS, sourceApp == old.sourceApp else { return false }
        let expected = old.positionS + (updatedAt - old.updatedAt) / 1000 * old.rate
        return abs(expected - positionS) < tolerance
    }
}
