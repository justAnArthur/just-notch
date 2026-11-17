import AppKit
import WebKit

/// The panel's web view: clicks outside the hit regions fall through, file drags land on the island.
final class NotchWebView: WKWebView {
    weak var controller: PanelController?
    private(set) var lastMouseDown: NSEvent?
    private var trackingArea: NSTrackingArea?
    /// Set when the page commits a swipe: the rest of that finger gesture and its momentum never reach it.
    private var swallowUntil: Date?

    /// `window.endGesture`: the page took this gesture as a swipe. Fingers touching down again (or a mouse
    /// wheel, or a stuck state after 2 s) hand wheel events back to it.
    func endGesture() {
        swallowUntil = Date().addingTimeInterval(2)
    }

    override func scrollWheel(with event: NSEvent) {
        if let until = swallowUntil {
            let touchedDown = event.phase.contains(.began) || event.phase.contains(.mayBegin)
            let mouseWheel = event.phase.isEmpty && event.momentumPhase.isEmpty
            guard touchedDown || mouseWheel || Date() > until else { return }
            swallowUntil = nil
        }
        super.scrollWheel(with: event)
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let controller, let superview else { return super.hitTest(point) }
        let inWindow = superview.convert(point, to: nil)
        return controller.isInteractive(atWindowPoint: inWindow) ? super.hitTest(point) : nil
    }

    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        controller?.pointerMoved()
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        controller?.pointerMoved()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(rect: .zero, options: [.activeAlways, .inVisibleRect, .mouseMoved, .mouseEnteredAndExited], owner: self)
        addTrackingArea(area)
        trackingArea = area
    }

    // MARK: file drops

    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        guard let urls = fileURLs(sender) else { return super.draggingEntered(sender) }
        controller?.fileDragging(active: true, count: urls.count)
        return .copy
    }

    override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
        guard fileURLs(sender) != nil else { return super.draggingUpdated(sender) }
        return .copy
    }

    override func draggingExited(_ sender: (any NSDraggingInfo)?) {
        guard let sender, fileURLs(sender) != nil else { return super.draggingExited(sender) }
        controller?.fileDragging(active: false, count: 0)
    }

    override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        fileURLs(sender) != nil || super.prepareForDragOperation(sender)
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        guard let urls = fileURLs(sender) else { return super.performDragOperation(sender) }
        controller?.fileDragging(active: false, count: 0)
        controller?.filesDropped(urls)
        return true
    }

    override func concludeDragOperation(_ sender: (any NSDraggingInfo)?) {
        guard let sender, fileURLs(sender) != nil else { return super.concludeDragOperation(sender) }
    }

    /// File URLs of an external drag; nil for other drags (in-page HTML drags stay with WebKit) and our own drags out.
    private func fileURLs(_ sender: any NSDraggingInfo) -> [URL]? {
        guard !(sender.draggingSource is FileDragSource) else { return nil }
        let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]
        guard let urls, !urls.isEmpty else { return nil }
        return urls
    }
}

/// Source of drags started by `files.beginDrag`.
final class FileDragSource: NSObject, NSDraggingSource {
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        context == .outsideApplication ? .copy : []
    }
}
