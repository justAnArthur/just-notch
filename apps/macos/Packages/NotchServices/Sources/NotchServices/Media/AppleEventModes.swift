import AppKit

/// Shuffle, repeat and like as a player reports them over Apple Events.
struct PlayerModes: Equatable, Sendable {
    var shuffle: Bool?
    var `repeat`: MediaState.Repeat?
    var liked: Bool?
    /// nil: all three.
    var repeatModes: [MediaState.Repeat]?
}

/// Music and Spotify publish no shuffle, repeat or like through MediaRemote (Spotify) or not always (Music),
/// but both script them. Spotify's repeat is a bool (off/all) and it has no like; Music's `favorited` was
/// `loved` before macOS 15, the same code `pLov`, so the script uses the raw code.
enum AppleEventModes {
    static let music = "com.apple.Music"
    static let spotify = "com.spotify.client"
    static let players: Set<String> = [music, spotify]

    static func spotify(shuffling: Bool, repeating: Bool) -> PlayerModes {
        PlayerModes(shuffle: shuffling, repeat: repeating ? .all : .off, repeatModes: [.off, .all])
    }

    static func music(shuffle: Bool, repeat code: OSType, favorited: Bool?) -> PlayerModes {
        PlayerModes(shuffle: shuffle, repeat: musicRepeat[code], liked: favorited)
    }

    private static let musicRepeat: [OSType: MediaState.Repeat] = [code("kRpO"): .off, code("kRp1"): .one, code("kAll"): .all]

    static func code(_ text: String) -> OSType { text.utf8.reduce(0) { $0 << 8 | OSType($1) } }

    static func readScript(_ bundleId: String) -> String? {
        switch bundleId {
        case spotify: "tell application id \"\(spotify)\" to return {shuffling, repeating}"
        case music:
            """
            tell application id "\(music)"
                set f to missing value
                try
                    set f to «class pLov» of current track
                end try
                return {shuffle enabled, song repeat, f}
            end tell
            """
        default: nil
        }
    }

    static func parse(_ result: NSAppleEventDescriptor, bundleId: String) -> PlayerModes? {
        guard result.numberOfItems >= 2, let first = result.atIndex(1), let second = result.atIndex(2) else { return nil }
        switch bundleId {
        case spotify: return spotify(shuffling: first.booleanValue, repeating: second.booleanValue)
        case music:
            let favorited = result.atIndex(3).flatMap { $0.descriptorType == typeBoolean || $0.descriptorType == typeTrue || $0.descriptorType == typeFalse ? $0.booleanValue : nil }
            return music(shuffle: first.booleanValue, repeat: second.enumCodeValue, favorited: favorited)
        default: return nil
        }
    }

    static func commandScript(_ command: MediaCommand, bundleId: String) -> String? {
        switch (bundleId, command) {
        case (spotify, .shuffle(let on)): "tell application id \"\(spotify)\" to set shuffling to \(on)"
        // Spotify has no repeat-one: the closest is repeating the context.
        case (spotify, .repeat(let mode)): "tell application id \"\(spotify)\" to set repeating to \(mode != .off)"
        case (music, .shuffle(let on)): "tell application id \"\(music)\" to set shuffle enabled to \(on)"
        case (music, .repeat(let mode)): "tell application id \"\(music)\" to set song repeat to \(mode.rawValue)"
        case (music, .like(let liked)): "tell application id \"\(music)\" to set «class pLov» of current track to \(liked)"
        default: nil
        }
    }
}

/// Polls the modes of one player, once a second while it is the now-playing source. Runs the events on
/// a queue of its own: the first one may wait on the Automation prompt. Never launches the player.
@MainActor
final class AppleEventModePoller {
    var onChange: ((PlayerModes?) -> Void)?
    private(set) var bundleId: String?
    private(set) var modes: PlayerModes?

    private let queue = DispatchQueue(label: "just-notch.media.apple-events")
    private var timer: Timer?
    private var generation = 0
    private var reading = false

    func watch(_ bundleId: String?) {
        let bundleId = bundleId.flatMap { AppleEventModes.players.contains($0) ? $0 : nil }
        guard bundleId != self.bundleId else { return }
        self.bundleId = bundleId
        generation += 1
        reading = false
        timer?.invalidate()
        timer = nil
        modes = nil
        guard bundleId != nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        poll()
    }

    func send(_ command: MediaCommand) {
        guard let bundleId, let script = AppleEventModes.commandScript(command, bundleId: bundleId) else { return }
        let current = generation
        queue.async { [weak self] in
            if Self.running(bundleId) { _ = Self.run(script) }
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.generation == current else { return }
                    self.reading = false
                    self.poll()
                }
            }
        }
    }

    private func poll() {
        guard let bundleId, !reading, let script = AppleEventModes.readScript(bundleId) else { return }
        reading = true
        let current = generation
        queue.async { [weak self] in
            let outcome: Outcome = if !Self.running(bundleId) {
                .gone
            } else {
                switch Self.run(script) {
                case .success(let result): AppleEventModes.parse(result, bundleId: bundleId).map(Outcome.read) ?? .failed
                case .failure(let error): error.code == errAEEventNotPermitted ? .gone : .failed
                }
            }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.receive(outcome, generation: current) }
            }
        }
    }

    private enum Outcome: Sendable {
        case read(PlayerModes)
        /// Not running or not permitted: the toggles hide.
        case gone
        /// Anything else keeps the last modes, so one failed read doesn't blink them.
        case failed
    }

    private func receive(_ outcome: Outcome, generation current: Int) {
        guard generation == current else { return }
        reading = false
        let next: PlayerModes? = switch outcome {
        case .read(let modes): modes
        case .gone: nil
        case .failed: modes
        }
        guard next != modes else { return }
        modes = next
        onChange?(next)
    }

    private nonisolated static func running(_ bundleId: String) -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty
    }

    private nonisolated static func run(_ source: String) -> Result<NSAppleEventDescriptor, AppleEventError> {
        var error: NSDictionary?
        guard let result = NSAppleScript(source: source)?.executeAndReturnError(&error) else {
            mediaLog.debug("apple events: \(error ?? [:], privacy: .public)")
            return .failure(AppleEventError(code: error?[NSAppleScript.errorNumber] as? Int ?? 0))
        }
        return .success(result)
    }
}

struct AppleEventError: Error { var code: Int }
