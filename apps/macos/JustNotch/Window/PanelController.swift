import AppKit
import NotchServices
import QuickLookThumbnailing

/// One notch panel on one screen: its web view, hit regions, hover zone and file drags.
@MainActor
final class PanelController {
    private static let hoverInset = (x: 20.0, y: 10.0)
    private static let dragImageSize = 64.0

    let panel: NotchPanel
    let webView: NotchWebView
    private(set) var geometry: ScreenGeometry
    private let events: EventDispatcher
    private let dragSource = FileDragSource()

    private var hitRegions: [Rect] = []
    private var hoverInside = false
    private var fileDragActive = false
    /// A file drag from another app is in flight (set by the app's pointer polling).
    private var externalFileDrag = false
    /// Faded out for a full-screen app on this screen, or a call (`ScreenLayout.hideWhen`).
    private(set) var steppedAside = false
    /// The last time the pointer was at the island, its shape changed or a drag touched it (`IdleReclaimer`).
    private(set) var lastActive = Date()

    /// Nothing is happening here: the pointer is away, no launcher, no file drag.
    var isQuiet: Bool { !hoverInside && !panel.launcher && !fileDragActive && !externalFileDrag }

    init(screen: NSScreen, events: EventDispatcher, makeWebView: (NSRect) -> NotchWebView) {
        let layout = ScreenLayout.layout(screen)
        self.events = events
        geometry = layout.geometry
        panel = NotchPanel(frame: layout.frame)
        webView = makeWebView(NSRect(origin: .zero, size: layout.frame.size))
        webView.controller = self
        webView.registerForDraggedTypes([.fileURL])
        panel.contentView = webView
        panel.orderFrontRegardless()
        PresenceMonitor.shared.add(self)
    }

    func move(to screen: NSScreen) {
        let layout = ScreenLayout.layout(screen)
        panel.setFrame(layout.frame, display: true)
        guard layout.geometry != geometry else { return }
        geometry = layout.geometry
        events.send("geometry", geometry, key: "geometry", to: [webView])
    }

    func close() {
        PresenceMonitor.shared.remove(self)
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        panel.close()
    }

    func setHitRegions(_ rects: [Rect]) {
        if rects != hitRegions { lastActive = Date() }
        hitRegions = rects
        pointerMoved()
    }

    // MARK: pointer

    /// Re-evaluates hover and click-through for the current pointer location.
    func pointerMoved(fileDrag: Bool? = nil) {
        if let fileDrag { externalFileDrag = fileDrag }
        let p = panelPoint(screen: NSEvent.mouseLocation)
        let inRegion = hitRegions.contains { $0.contains(p) }
        let inZone = inRegion || hoverZone.contains(p)
        if inZone || externalFileDrag || panel.launcher { lastActive = Date() }

        if inZone != hoverInside {
            hoverInside = inZone
            events.send("hover", HoverPayload(inside: inZone), key: "hover", to: [webView])
        }

        let interactive = !steppedAside && (inRegion || ((externalFileDrag || fileDragActive) && inZone))
        // Keep a press that started on the island (a drag gesture, a text selection) inside the panel.
        let pressed = NSEvent.pressedMouseButtons != 0 && !panel.ignoresMouseEvents && !externalFileDrag
        if panel.ignoresMouseEvents == interactive, interactive || !pressed {
            panel.ignoresMouseEvents = !interactive
        }
    }

    func isInteractive(atWindowPoint point: NSPoint) -> Bool {
        let p = CGPoint(x: point.x, y: geometry.panel.h - point.y)
        return fileDragActive || hitRegions.contains { $0.contains(p) }
    }

    private var hoverZone: Rect {
        geometry.notch.insetBy(dx: -Self.hoverInset.x, dy: -Self.hoverInset.y)
    }

    private func panelPoint(screen point: NSPoint) -> CGPoint {
        CGPoint(x: point.x - panel.frame.minX, y: panel.frame.maxY - point.y)
    }

    // MARK: stepping aside

    /// Fades the island out (or back) for what `PresenceMonitor` saw; never while the launcher is open here.
    func updatePresence(fullScreen: Set<String>, call: Bool) {
        let rules = ScreenLayout.hideWhen
        let aside = !panel.launcher && ((rules.fullScreen && fullScreen.contains(geometry.screenId)) || (rules.calls && call))
        guard aside != steppedAside else { return }
        steppedAside = aside
        if aside { panel.ignoresMouseEvents = true }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            panel.animator().alphaValue = aside ? 0 : 1
        }
        if !aside { pointerMoved() }
    }

    // MARK: files

    func fileDragging(active: Bool, count: Int) {
        guard active != fileDragActive || active else { return }
        fileDragActive = active
        lastActive = Date()
        events.send("files.dragging", DraggingPayload(active: active, count: count), key: "files.dragging", to: [webView])
        pointerMoved()
    }

    func filesDropped(_ urls: [URL]) {
        events.send("files.dropped", PathsPayload(paths: urls.map(\.path)), to: [webView])
    }

    func gestureTouched() {
        events.send("gesture.touch", payload: Data("{}".utf8), to: [webView])
    }

    /// Starts a native drag of `paths` from the last mouse-down on the island.
    func beginDrag(paths: [String]) async throws {
        let urls = paths.map { URL(fileURLWithPath: $0) }.filter { FileManager.default.fileExists(atPath: $0.path) }
        guard !urls.isEmpty else { throw ServiceError("no existing files to drag") }
        guard let event = webView.lastMouseDown else { throw ServiceError("files.beginDrag needs a pointerdown on the island") }

        var images: [NSImage] = []
        for url in urls { images.append(await Self.dragImage(url, scale: geometry.scale)) }
        guard NSEvent.pressedMouseButtons & 1 != 0 else { return }

        let origin = webView.convert(event.locationInWindow, from: nil)
        let size = Self.dragImageSize
        let items = zip(urls, images).enumerated().map { index, pair in
            let item = NSDraggingItem(pasteboardWriter: pair.0 as NSURL)
            let offset = Double(min(index, 4)) * 4
            item.setDraggingFrame(NSRect(x: origin.x - size / 2 + offset, y: origin.y - size / 2 + offset, width: size, height: size), contents: pair.1)
            return item
        }
        let session = webView.beginDraggingSession(with: items, event: event, source: dragSource)
        session.animatesToStartingPositionsOnCancelOrFail = true
    }

    private static func dragImage(_ url: URL, scale: Double) async -> NSImage {
        let request = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: dragImageSize, height: dragImageSize),
                                                   scale: scale, representationTypes: .thumbnail)
        if let cgImage = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).cgImage {
            return NSImage(cgImage: cgImage, size: NSSize(width: dragImageSize, height: dragImageSize))
        }
        return NSWorkspace.shared.icon(forFile: url.path)
    }
}

struct PathsPayload: Encodable {
    var paths: [String]
}

/// Watches what makes the island step aside, for every panel: Space and app switches (a full-screen app), screen
/// changes, and the microphone (a call). A Space switch animates, so the check runs again once it has settled.
@MainActor
final class PresenceMonitor {
    static let shared = PresenceMonitor()

    private var panels: [ObjectIdentifier: PanelController] = [:]
    private var observers: [NSObjectProtocol] = []
    private var stopMicrophone: (() -> Void)?
    private var settle: Task<Void, Never>?

    func add(_ panel: PanelController) {
        panels[ObjectIdentifier(panel)] = panel
        if observers.isEmpty { start() }
        check()
    }

    func remove(_ panel: PanelController) {
        panels[ObjectIdentifier(panel)] = nil
        if panels.isEmpty { stop() }
    }

    /// Settings changed (`ScreenLayout.hideWhen`): apply at once.
    func check() {
        let screens = Dictionary(NSScreen.screens.map { (ScreenLayout.id($0), CGDisplayBounds(ScreenLayout.displayId($0))) }) { a, _ in a }
        let rules = ScreenLayout.hideWhen
        var fullScreen = rules.fullScreen ? Presence.fullScreenNow(screens: screens) : []
        // The app in front says so itself; it sits on the main screen (the one with the menu bar it hid).
        if rules.fullScreen, fullScreen.isEmpty, NSApp.currentSystemPresentationOptions.contains(.fullScreen), let main = NSScreen.main {
            fullScreen.insert(ScreenLayout.id(main))
        }
        let call = rules.calls && Presence.microphoneInUse()
        for panel in panels.values { panel.updatePresence(fullScreen: fullScreen, call: call) }
    }

    private func start() {
        let center = NSWorkspace.shared.notificationCenter
        let names = [NSWorkspace.activeSpaceDidChangeNotification, NSWorkspace.didActivateApplicationNotification,
                     NSWorkspace.didDeactivateApplicationNotification]
        observers = names.map { name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.checkSettled() } }
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkSettled() }
        })
        stopMicrophone = Presence.watchMicrophone { Task { @MainActor in PresenceMonitor.shared.check() } }
    }

    private func stop() {
        for observer in observers {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            NotificationCenter.default.removeObserver(observer)
        }
        observers = []
        stopMicrophone?()
        stopMicrophone = nil
        settle?.cancel()
    }

    private func checkSettled() {
        check()
        settle?.cancel()
        settle = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            check()
        }
    }
}
