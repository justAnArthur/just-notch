import AppKit
import Carbon.HIToolbox
import NotchServices

/// The launcher: a global shortcut opens a search bar that drops out of the notch to where Spotlight's sits.
///
/// The page draws and animates it, in the panel (tall enough already, see `ScreenLayout.height`). The host
/// makes the panel key without activating the app (it's a non-activating panel, so the app in front keeps the
/// menu bar and gets the keyboard back) and lets the keyboard go once the page says it's closed.
@MainActor
final class Launcher {
    static let defaultShortcut = "Alt+Space"
    private static let shortcutKey = "launcher.shortcut"
    private static let enabledKey = "launcher.enabled"

    /// The bridge's host shortcuts: register an accelerator with an action, release one by id.
    var registerShortcut: ((String, @escaping () -> Void) throws -> String)?
    var unregisterShortcut: ((String) -> Void)?
    private var shortcutId: String?

    private let events: EventDispatcher
    private let panels: () -> [PanelController]
    private var open: PanelController?
    /// Asked to close: waiting for the page's `launcher.closed`.
    private var closing = false
    private var resignObserver: NSObjectProtocol?

    init(events: EventDispatcher, panels: @escaping () -> [PanelController]) {
        self.events = events
        self.panels = panels
    }

    /// The shortcut in Electron's syntax (`Alt+Space`), as Settings › Launcher set it.
    static var shortcut: String {
        UserDefaults.standard.string(forKey: shortcutKey) ?? defaultShortcut
    }

    static var enabled: Bool {
        UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    }

    var preferences: LauncherPreferences {
        LauncherPreferences(enabled: Self.enabled, shortcut: Self.shortcut, active: shortcutId != nil,
                            spotlightConflict: Self.isCommandSpace(Self.shortcut) && Self.spotlightUsesCommandSpace)
    }

    /// Registers the saved shortcut, if the launcher is on. A taken shortcut is logged and shows in Settings.
    func start() {
        do { try register(Self.shortcut) } catch {
            log.error("launcher shortcut \(Self.shortcut, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Settings › Launcher: a new shortcut is tried before it's saved, so a taken one leaves the old in place.
    func update(enabled: Bool?, shortcut: String?) throws {
        let nextEnabled = enabled ?? Self.enabled
        let nextShortcut = shortcut ?? Self.shortcut
        _ = try HotKeys.parse(nextShortcut)
        let previous = (Self.enabled, Self.shortcut)
        UserDefaults.standard.set(nextEnabled, forKey: Self.enabledKey)
        UserDefaults.standard.set(nextShortcut, forKey: Self.shortcutKey)
        do {
            try register(nextShortcut)
        } catch {
            UserDefaults.standard.set(previous.0, forKey: Self.enabledKey)
            UserDefaults.standard.set(previous.1, forKey: Self.shortcutKey)
            try? register(previous.1)
            throw error
        }
        if !nextEnabled { dismiss() }
    }

    private func register(_ shortcut: String) throws {
        if let shortcutId { unregisterShortcut?(shortcutId) }
        shortcutId = nil
        guard Self.enabled, let registerShortcut else { return }
        shortcutId = try registerShortcut(shortcut) { [weak self] in self?.toggle() }
    }

    private static func isCommandSpace(_ shortcut: String) -> Bool {
        guard let (key, modifiers) = try? HotKeys.parse(shortcut) else { return false }
        return key == UInt32(kVK_Space) && modifiers == UInt32(cmdKey)
    }

    /// Spotlight's "Show Spotlight search" (symbolic hot key 64) is on, as it is until the user turns it off.
    private static var spotlightUsesCommandSpace: Bool {
        let hotKeys = CFPreferencesCopyAppValue("AppleSymbolicHotKeys" as CFString, "com.apple.symbolichotkeys" as CFString) as? [String: Any]
        guard let entry = hotKeys?["64"] as? [String: Any] else { return true }
        return (entry["enabled"] as? NSNumber)?.boolValue ?? true
    }

    func toggle() {
        if open != nil { dismiss() } else { show() }
    }

    /// On the screen with the pointer, as Spotlight does.
    private func show() {
        let mouse = NSEvent.mouseLocation
        let all = panels()
        guard let target = all.first(where: { $0.panel.screen?.frame.contains(mouse) == true }) ?? all.first,
              let screen = target.panel.screen else { return }
        open = target
        closing = false

        target.panel.launcher = true
        target.panel.makeKey()
        target.panel.makeFirstResponder(target.webView)
        resignObserver = NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification, object: target.panel, queue: .main) { [weak self] _ in
            // Another app or window took the keyboard: a click outside, ⌘Tab, a notification.
            MainActor.assumeIsolated { self?.dismiss() }
        }
        send(open: true, to: target, screen: screen)
    }

    /// Asks the page to animate the launcher away; it answers with `launcher.closed`.
    func dismiss() {
        guard let target = open, !closing, let screen = target.panel.screen else { return }
        closing = true
        send(open: false, to: target, screen: screen)
        // A page that never answers (reloading, crashed) must not leave the panel grown and key.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.closing, self.open === target else { return }
                self.closed()
            }
        }
    }

    /// The page finished closing: the panel goes back to the island's size and lets the keyboard go.
    func closed() {
        guard let target = open else { return }
        open = nil
        closing = false
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
        resignObserver = nil
        target.panel.launcher = false
        if target.panel.isKeyWindow, !target.panel.focusable { target.panel.resignKey() }
    }

    /// Panels are being rebuilt (screens changed): nothing to animate, just let go.
    func reset() {
        guard open != nil else { return }
        closed()
    }

    private func send(open: Bool, to target: PanelController, screen: NSScreen) {
        let payload = LauncherPayload(open: open, top: ScreenLayout.launcherPillTop(screen))
        events.send("launcher", payload, key: "launcher", to: [target.webView])
    }
}
