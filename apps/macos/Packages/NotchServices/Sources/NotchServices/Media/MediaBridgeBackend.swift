import Foundation

/// MediaRemote from inside `/usr/bin/perl`. From macOS 15.4 mediaremoted only
/// serves Apple-signed clients; perl is one and can load our NotchMediaBridge
/// dylib through DynaLoader, which streams JSON lines back over stdout.
///
/// The host embeds the `NotchMediaBridge` product's dylib; `bridgeLibrary()`
/// lists where it is looked up (`NOTCH_MEDIA_BRIDGE` overrides).
@MainActor
final class MediaBridgeBackend: MediaBackend {
    let name = "MediaRemote via perl bridge"
    var onChange: ((RawNowPlaying?) -> Void)?
    var onFailure: (() -> Void)?

    private static let perl = URL(fileURLWithPath: "/usr/bin/perl")
    private static let script = """
    use DynaLoader;
    my $lib = DynaLoader::dl_load_file($ARGV[0], 0) or die DynaLoader::dl_error();
    my $sym = DynaLoader::dl_find_symbol($lib, "notch_media_bridge_run") or die "notch_media_bridge_run missing";
    my $run = DynaLoader::dl_install_xsub("main::run", $sym);
    &$run();
    """

    private struct Message: Decodable {
        var type: String
        var info: RawNowPlaying?
        var message: String?
    }

    private let library: URL
    private var process: Process?
    private var input: FileHandle?
    private var buffer = Data()
    private var readyContinuation: CheckedContinuation<Bool, Never>?
    /// State that arrived before the service attached `onChange`.
    private var early: RawNowPlaying??

    init?() {
        guard FileManager.default.isExecutableFile(atPath: Self.perl.path), let library = Self.bridgeLibrary() else { return nil }
        self.library = library
    }

    static func bridgeLibrary() -> URL? {
        let main = Bundle.main
        let executableDir = main.executableURL?.deletingLastPathComponent()
        let candidates: [URL?] = [
            ProcessInfo.processInfo.environment["NOTCH_MEDIA_BRIDGE"].map(URL.init(fileURLWithPath:)),
            main.privateFrameworksURL?.appendingPathComponent("NotchMediaBridge.framework/NotchMediaBridge"),
            main.privateFrameworksURL?.appendingPathComponent("libNotchMediaBridge.dylib"),
            main.resourceURL?.appendingPathComponent("libNotchMediaBridge.dylib"),
            executableDir?.appendingPathComponent("libNotchMediaBridge.dylib"),
            executableDir?.appendingPathComponent("PackageFrameworks/NotchMediaBridge.framework/NotchMediaBridge"),
        ]
        return candidates.compactMap(\.self).first { FileManager.default.fileExists(atPath: $0.path) }
    }

    /// Launches the helper and waits for its `ready` line.
    func launch(timeout: TimeInterval = 3) async -> Bool {
        let process = Process()
        process.executableURL = Self.perl
        process.arguments = ["-e", Self.script, library.path]
        let output = Pipe()
        let input = Pipe()
        process.standardOutput = output
        process.standardInput = input
        process.standardError = FileHandle.nullDevice

        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            if chunk.isEmpty { handle.readabilityHandler = nil }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.receive(chunk) }
            }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.terminated() }
            }
        }

        do { try process.run() } catch { return false }
        self.process = process
        self.input = input.fileHandleForWriting

        return await withCheckedContinuation { continuation in
            readyContinuation = continuation
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                MainActor.assumeIsolated { self?.resolveReady(false) }
            }
        }
    }

    func start() {
        guard let early else { return }
        self.early = nil
        onChange?(early)
    }

    func stop() {
        guard let process else { return }
        self.process = nil
        try? input?.close()
        input = nil
        if process.isRunning { process.terminate() }
    }

    func send(_ command: MediaCommand) {
        let line = switch command {
        case .play: "play"
        case .pause: "pause"
        case .toggle: "toggle"
        case .next: "next"
        case .previous: "previous"
        case .seek(let position): "seek \(position)"
        case .shuffle(let on): "shuffle \(MediaRemoteMode.code(shuffle: on))"
        case .repeat(let mode): "repeat \(MediaRemoteMode.code(repeat: mode))"
        case .like(let liked): "like \(liked ? 1 : 0)"
        }
        try? input?.write(contentsOf: Data((line + "\n").utf8))
    }

    private func resolveReady(_ ready: Bool) {
        readyContinuation?.resume(returning: ready)
        readyContinuation = nil
    }

    private func receive(_ chunk: Data) {
        guard !chunk.isEmpty else { return }
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<newline]
            buffer.removeSubrange(buffer.startIndex...newline)
            guard let message = try? JSONDecoder().decode(Message.self, from: line) else { continue }
            handle(message)
        }
    }

    private func handle(_ message: Message) {
        switch message.type {
        case "ready": resolveReady(true)
        case "state":
            if let onChange { onChange(message.info) } else { early = .some(message.info) }
        case "error":
            mediaLog.error("media bridge: \(message.message ?? "", privacy: .public)")
            resolveReady(false)
        default: mediaLog.debug("media bridge: \(message.message ?? message.type, privacy: .public)")
        }
    }

    private func terminated() {
        resolveReady(false)
        guard process != nil else { return }
        process = nil
        onFailure?()
    }
}
