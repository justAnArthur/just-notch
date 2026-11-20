import AppKit

/// `actions.shortcuts`, `actions.runShortcut` (the Shortcuts app through `/usr/bin/shortcuts`), `actions.system`, and
/// `actions.pasteText` (the launcher's answers).
@MainActor
public final class ActionsService: NotchService {
    public let methods = ["actions.shortcuts", "actions.runShortcut", "actions.system", "actions.pasteText"]
    public weak var sink: ServiceSink?

    private static let listTTL: TimeInterval = 60
    private var list: (names: [String], at: Date)?

    public init() {}

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "actions.shortcuts":
            return try await shortcuts().json()
        case "actions.runShortcut":
            let name = try decode(NameParams.self, params).name
            // Only names the Shortcuts app lists, so a name can never read as one of the tool's options.
            var names = try await shortcuts()
            if !names.contains(name) { names = try await shortcuts(fresh: true) }
            guard names.contains(name) else {
                throw ServiceError("no shortcut named \(name)")
            }
            _ = try await Self.run("/usr/bin/shortcuts", ["run", name])
            return nil
        case "actions.system":
            try await system(try decode(SystemActionParams.self, params).action)
            return nil
        case "actions.pasteText":
            // Copied first, so it stays on the pasteboard even when the paste can't happen.
            let text = try decode(TextParams.self, params).text
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            return PastedResult(pasted: await Paste.intoFrontApp()).json()
        default:
            throw ServiceError("unknown method \(method)")
        }
    }

    private func shortcuts(fresh: Bool = false) async throws -> [String] {
        if !fresh, let list, Date().timeIntervalSince(list.at) < Self.listTTL { return list.names }
        let names = try await Self.run("/usr/bin/shortcuts", ["list"])
            .split(whereSeparator: \.isNewline).map(String.init).filter { !$0.isEmpty }
        list = (names, Date())
        return names
    }

    private func system(_ action: SystemAction) async throws {
        switch action {
        case .sleep:
            _ = try await Self.run("/usr/bin/pmset", ["sleepnow"])
        case .displaySleep:
            _ = try await Self.run("/usr/bin/pmset", ["displaysleepnow"])
        case .screenSaver:
            let engine = URL(fileURLWithPath: "/System/Library/CoreServices/ScreenSaverEngine.app")
            _ = try await NSWorkspace.shared.openApplication(at: engine, configuration: NSWorkspace.OpenConfiguration())
        // osascript rather than NSAppleScript: Finder may take seconds to empty a full Trash, and NSAppleScript
        // must run on the main thread. TCC still asks for (and attributes) Automation to Just Notch.
        case .emptyTrash:
            _ = try await Self.run("/usr/bin/osascript", ["-e", #"tell application "Finder" to empty trash"#])
        case .toggleDarkMode:
            _ = try await Self.run("/usr/bin/osascript", ["-e", #"tell application "System Events" to tell appearance preferences to set dark mode to not dark mode"#])
        case .lockScreen:
            try Self.lockScreen()
        // loginwindow's "show the dialog" events: macOS asks itself (with its countdown and Cancel), as the Apple menu does.
        case .restart:
            _ = try await Self.run("/usr/bin/osascript", ["-e", #"tell application "loginwindow" to «event aevtrrst»"#])
        case .shutDown:
            _ = try await Self.run("/usr/bin/osascript", ["-e", #"tell application "loginwindow" to «event aevtrsdn»"#])
        case .logOut:
            _ = try await Self.run("/usr/bin/osascript", ["-e", #"tell application "loginwindow" to «event aevtlogo»"#])
        case .quitFrontApp:
            // The launcher's panel never activates, so the app in front is the one it opened over.
            guard let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier != Bundle.main.bundleIdentifier else {
                throw ServiceError("no app in front to quit")
            }
            guard app.terminate() else { throw ServiceError("\(app.localizedName ?? "The app") didn't quit") }
        }
    }

    /// Locks at once, as ⌃⌘Q does: `SACLockScreenImmediate` from the login framework, the call the Apple menu's Lock
    /// Screen makes.
    private static func lockScreen() throws {
        typealias Lock = @convention(c) () -> Int32
        guard let framework = dlopen("/System/Library/PrivateFrameworks/login.framework/Versions/Current/login", RTLD_LAZY),
              let symbol = dlsym(framework, "SACLockScreenImmediate") else {
            throw ServiceError("this macOS can't lock the screen from here")
        }
        _ = unsafeBitCast(symbol, to: Lock.self)()
    }

    /// Runs a tool off the main thread; its standard output, or its standard error as the failure.
    nonisolated static func run(_ tool: String, _ arguments: [String]) async throws -> String {
        try await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: tool)
            process.arguments = arguments
            let output = Pipe()
            let errors = Pipe()
            process.standardOutput = output
            process.standardError = errors
            process.standardInput = FileHandle.nullDevice
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let error = errors.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                let message = String(decoding: error, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                throw ServiceError(message.isEmpty ? "\((tool as NSString).lastPathComponent) failed (\(process.terminationStatus))" : message)
            }
            return String(decoding: data, as: UTF8.self)
        }.value
    }
}
