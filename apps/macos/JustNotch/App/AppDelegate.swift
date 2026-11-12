import AppKit
import ServiceManagement
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// `NOTCH_DEV_URL` (e.g. http://localhost:5174): load the runtime and plugins from the Vite dev server.
    let devServer: URL? = ProcessInfo.processInfo.environment["NOTCH_DEV_URL"]
        .flatMap { URL(string: $0.hasSuffix("/") ? String($0.dropLast()) : $0) }

    private let events = EventDispatcher()
    private let scheme = SchemeHandler()
    private lazy var lifecycle = WebLifecycle(origin: origin)
    private lazy var plugins = PluginStore(origin: origin)
    private lazy var bridge = Bridge(plugins: plugins, events: events)

    private var panels: [String: PanelController] = [:]
    private var settingsWindow: NSWindow?
    private(set) var settingsWebView: WKWebView?
    private var statusItem: NSStatusItem?
    private var launchAtLoginItem: NSMenuItem?
    private var monitors: [Any] = []
    private var pressTimer: Timer?
    private var dragChangeCount = 0

    private var origin: String { devServer?.absoluteString ?? SchemeHandler.origin }

    var webViews: [WKWebView] {
        panels.values.map(\.webView) + [settingsWebView].compactMap { $0 }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        bridge.app = self
        bridge.startServices()
        lifecycle.onTerminate = { [weak self] webView in self?.bridge.release(webView) }
        plugins.onChange = { [weak self] in self?.pluginsChanged() }
        plugins.watch()

        NSApp.mainMenu = MainMenu.make()
        installStatusItem()
        rebuildPanels()
        installPointerMonitors()

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuildPanels() }
        }
        log.info("launched, dev server: \(self.devServer?.absoluteString ?? "none", privacy: .public)")
    }

    // MARK: panels

    func panel(for webView: WKWebView) -> PanelController? {
        panels.values.first { $0.webView === webView }
    }

    func geometry(for webView: WKWebView) -> ScreenGeometry {
        if let panel = panel(for: webView) { return panel.geometry }
        if let panel = panels.values.first { return panel.geometry }
        return ScreenLayout.layout(NSScreen.main ?? NSScreen.screens[0]).geometry
    }

    /// Keeps one panel per target screen: moves existing ones (sending `geometry`), adds and removes the rest.
    func rebuildPanels() {
        let screens = ScreenLayout.targetScreens()
        let ids = Set(screens.map(ScreenLayout.id))
        for (id, panel) in panels where !ids.contains(id) {
            bridge.release(panel.webView)
            panel.close()
            panels[id] = nil
        }
        for screen in screens {
            let id = ScreenLayout.id(screen)
            if let panel = panels[id] {
                panel.move(to: screen)
                continue
            }
            let panel = PanelController(screen: screen, events: events) { [unowned self] frame in
                WebViews.make(NotchWebView.self, frame: frame, bridge: bridge, scheme: scheme, lifecycle: lifecycle)
            }
            WebViews.load(panel.webView, page: "index.html", devServer: devServer)
            panels[id] = panel
        }
    }

    private func pluginsChanged() {
        events.send("plugins.changed", PluginsChangedPayload(plugins: plugins.plugins), key: "plugins.changed", to: webViews)
    }

    private func reloadUI() {
        plugins.reload()
        for webView in webViews {
            bridge.release(webView)
            webView.reload()
        }
    }

    // MARK: pointer

    /// Hover and click-through must work while the app is inactive: global monitors see events
    /// for other apps, local ones and the web view's tracking area see ours. While a button is
    /// held (a file drag from Finder), the pointer is polled because drag loops swallow events.
    private func installPointerMonitors() {
        let mask: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .leftMouseDown, .leftMouseUp]
        let handle: (NSEvent) -> Void = { [weak self] event in
            MainActor.assumeIsolated { self?.pointerEvent(event.type) }
        }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: handle) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { handle($0); return $0 }) { monitors.append(local) }
    }

    private func pointerEvent(_ type: NSEvent.EventType) {
        if type == .leftMouseDown {
            dragChangeCount = NSPasteboard(name: .drag).changeCount
            startPressPolling()
        }
        pointerMoved()
    }

    private func pointerMoved() {
        // The drag pasteboard is an IPC round-trip: read it only while the button is held.
        let fileDrag = NSEvent.pressedMouseButtons & 1 != 0 && {
            let drag = NSPasteboard(name: .drag)
            return drag.changeCount != dragChangeCount && drag.types?.contains(.fileURL) ?? false
        }()
        for panel in panels.values { panel.pointerMoved(fileDrag: fileDrag) }
    }

    private func startPressPolling() {
        guard pressTimer == nil else { return }
        pressTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.pointerMoved()
                if NSEvent.pressedMouseButtons & 1 == 0 {
                    self.pressTimer?.invalidate()
                    self.pressTimer = nil
                }
            }
        }
    }

    // MARK: settings

    @objc func openSettings() {
        if settingsWindow == nil {
            let frame = NSRect(x: 0, y: 0, width: 760, height: 520)
            let window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
            window.title = "Just Notch Settings"
            window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 640, height: 440)
            let webView = WebViews.make(WKWebView.self, frame: frame, bridge: bridge, scheme: scheme, lifecycle: lifecycle)
            window.contentView = webView
            window.center()
            WebViews.load(webView, page: "settings.html", devServer: devServer)
            settingsWindow = window
            settingsWebView = webView
        }
        // The cooperative `activate()` is declined when opened from the non-activating panel.
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    // MARK: status item

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "capsule.fill", accessibilityDescription: "Just Notch")
        let menu = NSMenu()
        menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
        menu.addItem(withTitle: "Reload UI", action: #selector(reloadUIAction), keyEquivalent: "r").target = self
        let launch = menu.addItem(withTitle: "Launch at Login", action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        launch.target = self
        launch.state = launchAtLogin ? .on : .off
        launchAtLoginItem = launch
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Just Notch", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
    }

    @objc private func reloadUIAction() { reloadUI() }

    @objc private func toggleLaunchAtLogin() {
        do {
            try setLaunchAtLogin(!launchAtLogin)
        } catch {
            log.error("launch at login: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: preferences

    var launchAtLogin: Bool { SMAppService.mainApp.status == .enabled }

    func setLaunchAtLogin(_ enabled: Bool) throws {
        defer { launchAtLoginItem?.state = launchAtLogin ? .on : .off }
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }

    var preferences: AppPreferences {
        AppPreferences(launchAtLogin: launchAtLogin, screens: ScreenLayout.screens)
    }

    func setPreferences(_ update: PreferencesParams) throws {
        if let screens = update.screens, screens != ScreenLayout.screens {
            ScreenLayout.screens = screens
            rebuildPanels()
        }
        if let enabled = update.launchAtLogin, enabled != launchAtLogin {
            try setLaunchAtLogin(enabled)
        }
    }
}
