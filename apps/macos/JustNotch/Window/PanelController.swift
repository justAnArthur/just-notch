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
    }

    func move(to screen: NSScreen) {
        let layout = ScreenLayout.layout(screen)
        panel.setFrame(layout.frame, display: true)
        guard layout.geometry != geometry else { return }
        geometry = layout.geometry
        events.send("geometry", geometry, key: "geometry", to: [webView])
    }

    func close() {
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        panel.close()
    }

    func setHitRegions(_ rects: [Rect]) {
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

        if inZone != hoverInside {
            hoverInside = inZone
            events.send("hover", HoverPayload(inside: inZone), key: "hover", to: [webView])
        }

        let interactive = inRegion || ((externalFileDrag || fileDragActive) && inZone)
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

    // MARK: files

    func fileDragging(active: Bool, count: Int) {
        guard active != fileDragActive || active else { return }
        fileDragActive = active
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
