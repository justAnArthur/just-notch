import AppKit

/// Polls Music.app and Spotify over Apple Events once a second. Needs the
/// Automation permission; only apps that are already running are asked, so
/// polling never launches one.
@MainActor
final class AppleScriptBackend: MediaBackend {
    let name = "AppleScript polling (Music, Spotify)"
    var onChange: ((RawNowPlaying?) -> Void)?
    var onFailure: (() -> Void)?

    private struct Player {
        let bundleId: String
        /// Duration is reported in this unit per second (Spotify: ms).
        let durationScale: Double

        var target: String { "application id \"\(bundleId)\"" }
    }

    private static let players = [
        Player(bundleId: "com.apple.Music", durationScale: 1),
        Player(bundleId: "com.spotify.client", durationScale: 1000),
    ]

    private var timer: Timer?
    private var active: Player?
    private var artworkTrack: String?
    private var artworkTask: Task<Void, Never>?

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        poll()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        artworkTask?.cancel()
        artworkTrack = nil
        active = nil
    }

    func send(_ command: MediaCommand) {
        guard let player = active ?? Self.players.first(where: Self.isRunning) else { return }
        let verb: String
        switch command {
        case .play: verb = "play"
        case .pause: verb = "pause"
        case .toggle: verb = "playpause"
        case .next: verb = "next track"
        case .previous: verb = "previous track"
        case .seek(let position): verb = "set player position to \(position)"
        // Not read over Apple Events, so their toggles never show for this backend.
        case .shuffle, .repeat, .like: return
        }
        _ = Self.run("tell \(player.target) to \(verb)")
        poll()
    }

    private static func isRunning(_ player: Player) -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: player.bundleId).isEmpty
    }

    private static func run(_ source: String) -> NSAppleEventDescriptor? {
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error { mediaLog.debug("applescript: \(error, privacy: .public)") }
        return result
    }

    private func poll() {
        let states = Self.players.filter(Self.isRunning).compactMap { player in read(player).map { (player, $0) } }
        guard let (player, track) = states.first(where: { $0.1.state.playing }) ?? states.first else {
            active = nil
            artworkTrack = nil
            onChange?(nil)
            return
        }
        active = player
        var state = track.state
        if track.id != artworkTrack {
            artworkTrack = track.id
            state.artworkCleared = true
            loadArtwork(player)
        }
        onChange?(state)
    }

    private func read(_ player: Player) -> (id: String, state: RawNowPlaying)? {
        let source = """
        tell \(player.target)
            if player state is stopped then return {}
            set t to current track
            return {player state is playing, name of t, artist of t, album of t, duration of t, player position, id of t as text}
        end tell
        """
        guard let list = Self.run(source), list.numberOfItems >= 7 else { return nil }
        let playing = list.atIndex(1)?.booleanValue ?? false
        let trackId = list.atIndex(7)?.stringValue ?? ""
        let state = RawNowPlaying(
            title: list.atIndex(2)?.stringValue ?? "",
            artist: list.atIndex(3)?.stringValue ?? "",
            album: list.atIndex(4)?.stringValue ?? "",
            durationS: (list.atIndex(5)?.doubleValue ?? 0) / player.durationScale,
            positionS: list.atIndex(6)?.doubleValue ?? 0,
            rate: playing ? 1 : 0,
            playing: playing,
            timestamp: nowMs(),
            bundleId: player.bundleId
        )
        return (trackId, state)
    }

    private func loadArtwork(_ player: Player) {
        artworkTask?.cancel()
        let track = artworkTrack
        let deliver: (Data) -> Void = { [weak self] data in
            guard let self, self.artworkTrack == track, self.timer != nil else { return }
            self.poll(withArtwork: data)
        }

        if player.bundleId == "com.apple.Music" {
            guard let data = Self.run("tell \(player.target) to get data of artwork 1 of current track")?.data, !data.isEmpty else { return }
            artworkTask = Task { deliver(data) }
            return
        }
        guard let link = Self.run("tell \(player.target) to get artwork url of current track")?.stringValue,
              let url = URL(string: link) else { return }
        artworkTask = Task {
            guard let (data, _) = try? await URLSession.shared.data(from: url), !Task.isCancelled else { return }
            deliver(data)
        }
    }

    private func poll(withArtwork artwork: Data) {
        guard let player = active, var state = read(player)?.state else { return }
        state.artwork = artwork
        state.artworkCleared = nil
        onChange?(state)
    }
}
