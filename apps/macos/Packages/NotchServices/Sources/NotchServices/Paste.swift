import AppKit
import ApplicationServices
import Carbon.HIToolbox

/// ⌘V into the app in front, for the clipboard history's Paste and the launcher's answers.
@MainActor
enum Paste {
    private static var askedForAccessibility = false

    /// Needs Accessibility; without it, asks once per run and returns false (what was copied stays copied).
    static func intoFrontApp() async -> Bool {
        guard AXIsProcessTrusted() else {
            if !askedForAccessibility {
                askedForAccessibility = true
                AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
            }
            return false
        }
        // The launcher has just closed: give the target app the keyboard back first.
        try? await Task.sleep(for: .milliseconds(60))
        let source = CGEventSource(stateID: .combinedSessionState)
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: down)
            event?.flags = .maskCommand
            event?.post(tap: .cghidEventTap)
        }
        return true
    }
}
