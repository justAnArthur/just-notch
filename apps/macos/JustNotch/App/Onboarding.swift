import AppKit
import WebKit

/// The Welcome window: four steps (welcome, the island, the launcher, permissions one by one) in its own page,
/// `onboarding.html`. Shown once on a fresh profile, again from the menu or Settings › About.
@MainActor
final class Onboarding: NSObject, NSWindowDelegate {
    private static let doneKey = "onboarding.done"
    static let size = NSSize(width: 600, height: 480)

    private var window: NSWindow?
    private var webView: WKWebView?
    private let makeWebView: (NSRect) -> WKWebView
    private let load: (WKWebView) -> Void
    /// The bridge lets go of the page's subscriptions when the window closes.
    var onClose: ((WKWebView) -> Void)?

    init(makeWebView: @escaping (NSRect) -> WKWebView, load: @escaping (WKWebView) -> Void) {
        self.makeWebView = makeWebView
        self.load = load
    }

    /// A fresh profile: nothing marked done, and Sparkle hasn't seen this app launch before (someone updating
    /// from a version without onboarding has it set, and doesn't need the tour).
    static func isFirstRun(launchedBefore: Bool) -> Bool {
        if UserDefaults.standard.bool(forKey: doneKey) { return false }
        if launchedBefore {
            UserDefaults.standard.set(true, forKey: doneKey)
            return false
        }
        return true
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        if let window {
            window.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.size), styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.title = "Welcome to Just Notch"
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = .black
        window.delegate = self
        let webView = makeWebView(NSRect(origin: .zero, size: Self.size))
        window.contentView = webView
        load(webView)
        // Centred under the notch, so the island opening above it reads as part of the tour.
        if let screen = NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) ?? NSScreen.main {
            let visible = screen.visibleFrame
            window.setFrameTopLeftPoint(NSPoint(x: visible.midX - Self.size.width / 2, y: visible.maxY - 120))
        } else {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        self.window = window
        self.webView = webView
    }

    /// The page's Finish: done for good, and the window goes.
    func finish() {
        UserDefaults.standard.set(true, forKey: Self.doneKey)
        window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        // Closing it any other way counts as done too: it was seen.
        UserDefaults.standard.set(true, forKey: Self.doneKey)
        if let webView { onClose?(webView) }
        window = nil
        webView = nil
    }
}
