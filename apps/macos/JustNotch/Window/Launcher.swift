import AppKit

/// The launcher: a global shortcut opens a search bar that drops out of the notch to where Spotlight's sits.
///
/// The page draws and animates it. The host grows the panel to make room, makes it key without activating
/// the app (it's a non-activating panel, so the app in front keeps the menu bar and gets the keyboard back),
/// and shrinks it again once the page says its closing animation is done.
@MainActor
final class Launcher {
    static let defaultShortcut = "Alt+Space"
    private static let shortcutKey = "launcher.shortcut"

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

    /// The shortcut in Electron's syntax (`Alt+Space`); a user's choice once Settings has one.
    static var shortcut: String {
        UserDefaults.standard.string(forKey: shortcutKey) ?? defaultShortcut
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

        target.move(to: screen, height: ScreenLayout.launcherHeight(screen))
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
        if let screen = target.panel.screen { target.move(to: screen) }
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
