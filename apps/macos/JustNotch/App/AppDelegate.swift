import AppKit
import ServiceManagement
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation, NSMenuDelegate {
    /// `NOTCH_DEV_URL` (e.g. http://localhost:5174): load the runtime and plugins from the Vite dev server.
    let devServer: URL? = ProcessInfo.processInfo.environment["NOTCH_DEV_URL"]
        .flatMap { URL(string: $0.hasSuffix("/") ? String($0.dropLast()) : $0) }

    private let events = EventDispatcher()
    private let scheme = SchemeHandler()
    private lazy var lifecycle = WebLifecycle(origin: origin)
    private lazy var plugins = PluginStore(origin: origin)
    private lazy var bridge = Bridge(plugins: plugins, events: events)
    private(set) lazy var updater = Updater()
    private lazy var onboarding = Onboarding(
        makeWebView: { [unowned self] frame in WebViews.make(WKWebView.self, frame: frame, bridge: bridge, scheme: scheme, lifecycle: lifecycle) },
        load: { [unowned self] webView, page in WebViews.load(webView, page: page, devServer: devServer) }
    )
    private(set) lazy var launcher = Launcher(events: events) { [unowned self] in Array(panels.values) }

    private var panels: [String: PanelController] = [:]
    private var statusItem: NSStatusItem?
    private var launcherItem: NSMenuItem?
    private var warningItems: [NSMenuItem] = []
    private var reloadItem: NSMenuItem?
    private var monitors: [Any] = []
    private var pressTimer: Timer?
    private var dragChangeCount = 0
    /// The `justnotch://` URL the app was launched with: one that arrives before any page is up.
    private(set) var initialDeepLink: String?
    private var pagesUp = false
    #if DEBUG
    private var probe: DebugProbe?
    #endif

    private var origin: String { devServer?.absoluteString ?? SchemeHandler.origin }

    var webViews: [WKWebView] {
        panels.values.map(\.webView)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Read before Sparkle starts (and sets it): an app that launched before isn't a fresh profile.
        let launchedBefore = UserDefaults.standard.bool(forKey: "SUHasLaunchedBefore")
        bridge.app = self
        bridge.startServices()
        lifecycle.onTerminate = { [weak self] webView in self?.bridge.release(webView) }
        plugins.onChange = { [weak self] in self?.pluginsChanged() }
        plugins.watch()
        updater.onState = { [weak self] state in
            guard let self else { return }
            events.send("updater.state", state, key: "updater.state", to: webViews)
        }

        NSApp.mainMenu = MainMenu.make()
        installStatusItem()
        rebuildPanels()
        installPointerMonitors()
        registerLauncherShortcut()
        #if DEBUG
        // The Welcome window's page while it's open, else the island's.
        probe = DebugProbe { [weak self] in self?.onboarding.openWebView ?? self?.panels.values.first?.webView }
        #endif

        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshStatusItem() }
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuildPanels() }
        }
        onboarding.onClose = { [weak self] webView in self?.bridge.release(webView) }
        if Onboarding.isFirstRun(launchedBefore: launchedBefore) {
            // After the island's page is up, so it can open above the window.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.showOnboarding() }
        } else if Updater.justUpdated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.onboarding.show(whatsNew: true) }
        }
        log.info("launched, dev server: \(self.devServer?.absoluteString ?? "none", privacy: .public)")
    }

    // MARK: deep links

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme?.lowercased() == "justnotch" {
            guard pagesUp else {
                if initialDeepLink == nil { initialDeepLink = url.absoluteString }
                continue
            }
            guard let payload = try? JSONSerialization.data(withJSONObject: ["url": url.absoluteString]) else { continue }
            events.send("deepLink.open", payload: payload, to: webViews)
        }
    }

    /// A page said `host.ready`: from now on links go to the pages as they arrive.
    func pageReady() {
        pagesUp = true
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
        launcher.reset()
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
        launcher.reset()
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

    // MARK: launcher

    private func registerLauncherShortcut() {
        launcher.registerShortcut = { [unowned self] accelerator, action in try bridge.registerHostShortcut(accelerator, action: action) }
        launcher.unregisterShortcut = { [unowned self] id in bridge.unregisterHostShortcut(id) }
        launcher.start()
    }

    // MARK: settings

    /// Settings live in the island: the panel under the pointer (else the first) opens on its settings page.
    @objc func openSettings() {
        let mouse = NSEvent.mouseLocation
        let target = panels.values.first { $0.panel.screen?.frame.contains(mouse) == true } ?? panels.values.first
        guard let target else { return }
        // Text fields on the page need the app active; the panel itself never activates it.
        NSApp.activate(ignoringOtherApps: true)
        events.send("settings.open", payload: Data("{}".utf8), to: [target.webView])
    }

    // MARK: status item

    /// Primary actions first, then the app's own; a warning only while a permission is broken; Reload UI only
    /// in Debug builds or with ⌥ held. Launch at Login lives in Settings › General.
    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(named: "StatusIcon") ?? NSImage(systemSymbolName: "capsule.fill", accessibilityDescription: nil)
        image?.isTemplate = true
        image?.accessibilityDescription = "Just Notch"
        item.button?.image = image
        let menu = NSMenu()
        menu.delegate = self
        launcherItem = menu.addItem(withTitle: "Open Launcher", action: #selector(openLauncher), keyEquivalent: "")
        launcherItem?.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
        let update = menu.addItem(withTitle: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
        update.target = self
        updater.menuItem = update
        let warningSeparator = NSMenuItem.separator()
        menu.addItem(warningSeparator)
        let warning = menu.addItem(withTitle: "Accessibility Needs Attention…", action: #selector(openPermissions), keyEquivalent: "")
        warning.target = self
        warning.image = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "Warning")
        warningItems = [warningSeparator, warning]
        menu.addItem(.separator())
        menu.addItem(withTitle: "About Just Notch", action: #selector(showAbout), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Welcome Tour…", action: #selector(showOnboarding), keyEquivalent: "").target = self
        reloadItem = menu.addItem(withTitle: "Reload UI", action: #selector(reloadUIAction), keyEquivalent: "r")
        reloadItem?.target = self
        menu.addItem(withTitle: "Quit Just Notch", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
        refreshStatusItem()
    }

    /// Runs as the menu opens, so ⌥ and the permission state are read at that moment.
    func menuNeedsUpdate(_ menu: NSMenu) {
        refreshStatusItem()
        #if DEBUG
        reloadItem?.isHidden = false
        #else
        reloadItem?.isHidden = !NSEvent.modifierFlags.contains(.option)
        #endif
        let enabled = Launcher.enabled
        launcherItem?.isHidden = !enabled
        if let launcherItem, enabled {
            let (key, modifiers) = Self.keyEquivalent(Launcher.shortcut)
            launcherItem.keyEquivalent = key
            launcherItem.keyEquivalentModifierMask = modifiers
        }
    }

    // MARK: onboarding

    /// The Welcome window: on a fresh profile, from the menu, and from Settings › About (`onboarding.open`).
    @objc func showOnboarding() {
        onboarding.show()
    }

    /// `onboarding.finish`.
    func finishOnboarding() {
        onboarding.finish()
    }

    /// A call just found Accessibility missing or stale: the menu's warning follows at once.
    func accessibilityChanged() {
        refreshStatusItem()
    }

    /// The warning item and the icon's tooltip while Accessibility is broken.
    private func refreshStatusItem() {
        let broken = Accessibility.state() == .broken
        for item in warningItems { item.isHidden = !broken }
        statusItem?.button?.toolTip = broken ? "Just Notch: Accessibility needs attention" : "Just Notch"
    }

    @objc private func openLauncher() {
        launcher.toggle()
    }

    /// The island's settings on the Permissions page, through the same path as a `justnotch://settings/…` link.
    @objc private func openPermissions() {
        guard let payload = try? JSONSerialization.data(withJSONObject: ["url": "justnotch://settings/permissions"]) else { return }
        NSApp.activate(ignoringOtherApps: true)
        events.send("deepLink.open", payload: payload, to: webViews)
    }

    /// An Electron-style accelerator (`Alt+Space`) as a menu key equivalent, for display.
    static func keyEquivalent(_ accelerator: String) -> (String, NSEvent.ModifierFlags) {
        var modifiers: NSEvent.ModifierFlags = []
        var key = ""
        for part in accelerator.split(separator: "+").map({ $0.lowercased() }) {
            switch part {
            case "alt", "option": modifiers.insert(.option)
            case "cmd", "command", "commandorcontrol", "cmdorctrl", "super", "meta": modifiers.insert(.command)
            case "ctrl", "control": modifiers.insert(.control)
            case "shift": modifiers.insert(.shift)
            case "space": key = " "
            case "return", "enter": key = "\r"
            case "tab": key = "\t"
            default: key = part.count == 1 ? part : ""
            }
        }
        return (key, key.isEmpty ? [] : modifiers)
    }

    @objc private func reloadUIAction() { reloadUI() }

    // MARK: about

    /// Also reached from the app menu through the responder chain.
    @objc func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [.credits: Self.aboutCredits()])
    }

    /// Also reached from the app menu through the responder chain.
    @objc func checkForUpdates() {
        updater.install()
    }

    private static func aboutCredits() -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let base: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: NSFont.smallSystemFontSize),
            .foregroundColor: NSColor.secondaryLabelColor,
            .paragraphStyle: paragraph,
        ]
        let credits = NSMutableAttributedString()
        let links = [("Website", "https://justanarthur.github.io/just-notch/"), ("Source", "https://github.com/justAnArthur/just-notch")]
        for (index, (title, url)) in links.enumerated() {
            if index > 0 { credits.append(NSAttributedString(string: "  ·  ", attributes: base)) }
            var attributes = base
            attributes[.link] = URL(string: url)
            credits.append(NSAttributedString(string: title, attributes: attributes))
        }
        return credits
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        item.action != #selector(checkForUpdates) || updater.canCheck
    }

    // MARK: preferences

    var launchAtLogin: Bool { SMAppService.mainApp.status == .enabled }

    func setLaunchAtLogin(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }

    var preferences: AppPreferences {
        AppPreferences(launchAtLogin: launchAtLogin, screens: ScreenLayout.screens, launcher: launcher.preferences,
                       displays: ScreenLayout.displays(), hideWhen: ScreenLayout.hideWhen)
    }

    func setPreferences(_ update: PreferencesParams) throws {
        if let screens = update.screens, screens != ScreenLayout.screens {
            ScreenLayout.screens = screens
            rebuildPanels()
        }
        if let modes = update.displayModes {
            ScreenLayout.setModes(modes)
            rebuildPanels()
        }
        if let rules = update.hideWhen {
            ScreenLayout.hideWhen = HideWhen(fullScreen: rules.fullScreen ?? ScreenLayout.hideWhen.fullScreen, calls: rules.calls ?? ScreenLayout.hideWhen.calls)
            PresenceMonitor.shared.check()
        }
        if let enabled = update.launchAtLogin, enabled != launchAtLogin {
            try setLaunchAtLogin(enabled)
        }
        if let next = update.launcher {
            try launcher.update(enabled: next.enabled, shortcut: next.shortcut)
        }
    }
}
