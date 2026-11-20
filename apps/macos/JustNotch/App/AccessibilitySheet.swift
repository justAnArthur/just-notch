import AppKit

/// What the user reads before macOS asks for Accessibility, or when a grant has gone stale: never a raw system
/// prompt mid-action. One at a time, and not again for a minute after Not Now, so a repeated hotkey can't stack them.
@MainActor
enum AccessibilitySheet {
    enum Feature {
        case windows, paste, overlay

        var does: String {
            switch self {
            case .windows: "move and resize windows"
            case .paste: "paste from clipboard history"
            case .overlay: "show the volume and brightness overlay"
            }
        }
    }

    private static var showing = false
    private static var dismissedAt: Date?

    static func explain(_ feature: Feature, state: Accessibility.State) {
        guard state != .allowed, !showing else { return }
        if let dismissedAt, Date().timeIntervalSince(dismissedAt) < 60 { return }
        showing = true
        // After the call that led here has answered.
        Task { @MainActor in
            defer { showing = false }
            let alert = NSAlert()
            if state == .broken {
                alert.messageText = "Accessibility needs a reset"
                alert.informativeText = "System Settings shows Just Notch as on, but macOS isn't honouring it, as happens after some updates. In the list that opens, select Just Notch, remove it with −, add it back with +, then try again."
                alert.addButton(withTitle: "Open System Settings")
            } else {
                alert.messageText = "Allow Just Notch to \(feature.does)?"
                alert.informativeText = "macOS lets Just Notch \(feature.does) only with Accessibility. Click Continue and macOS asks; turn on Just Notch in System Settings, then come back. You can change it any time in Settings › Permissions."
                alert.addButton(withTitle: "Continue")
            }
            alert.addButton(withTitle: "Not Now")
            NSApp.activate(ignoringOtherApps: true)
            guard alert.runModal() == .alertFirstButtonReturn else {
                dismissedAt = Date()
                return
            }
            if state == .broken {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                    NSWorkspace.shared.open(url)
                }
            } else {
                Accessibility.prompt()
            }
        }
    }
}
