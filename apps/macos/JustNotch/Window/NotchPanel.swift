import AppKit

/// Borderless, transparent, non-activating panel above the menu bar on every space.
final class NotchPanel: NSPanel {
    /// Set by `window.setFocusable`: the runtime lets the panel become key while expanded.
    var focusable = false {
        didSet {
            if !focusable, isKeyWindow { resignKey() }
        }
    }

    override var canBecomeKey: Bool { focusable }
    override var canBecomeMain: Bool { false }

    init(frame: NSRect) {
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isFloatingPanel = true
        // After isFloatingPanel, which resets the level to .floating.
        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        hidesOnDeactivate = false
        isMovable = false
        isReleasedWhenClosed = false
        acceptsMouseMovedEvents = true
        ignoresMouseEvents = true
    }

    /// The default keeps windows below the menu bar; the panel's top edge must be flush with the screen top.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

enum ScreenLayout {
    static let panelSize = NSSize(width: 720, height: 320)
    static let virtualNotchWidth = 200.0
    static let virtualNotchHeight = 32.0

    /// The panel's frame on `screen` (centered on the notch, top edge flush) and its geometry.
    static func layout(_ screen: NSScreen) -> (frame: NSRect, geometry: ScreenGeometry) {
        let frame = screen.frame
        let notch = notchRect(screen)
        let origin = NSPoint(x: (notch.midX - panelSize.width / 2).rounded(), y: frame.maxY - panelSize.height)
        let panelFrame = NSRect(origin: origin, size: panelSize)
        let hasNotch = screen.safeAreaInsets.top > 0
        let geometry = ScreenGeometry(
            panel: .init(w: panelSize.width, h: panelSize.height),
            notch: Rect(x: notch.minX - panelFrame.minX, y: 0, w: notch.width, h: notch.height),
            hasNotch: hasNotch,
            scale: screen.backingScaleFactor,
            screenId: id(screen)
        )
        return (panelFrame, geometry)
    }

    /// The notch in global screen coordinates; a virtual one at the top center when there is none.
    private static func notchRect(_ screen: NSScreen) -> NSRect {
        let frame = screen.frame
        let top = screen.safeAreaInsets.top
        if top > 0, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            let width = frame.width - left.width - right.width
            return NSRect(x: frame.minX + left.width, y: frame.maxY - top, width: width, height: top)
        }
        let menuBar = frame.maxY - screen.visibleFrame.maxY
        let height = menuBar > 0 ? menuBar : virtualNotchHeight
        return NSRect(x: frame.midX - virtualNotchWidth / 2, y: frame.maxY - height, width: virtualNotchWidth, height: height)
    }

    static func displayId(_ screen: NSScreen) -> CGDirectDisplayID {
        screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID ?? 0
    }

    static func id(_ screen: NSScreen) -> String {
        let display = displayId(screen)
        guard let uuid = CGDisplayCreateUUIDFromDisplayID(display)?.takeRetainedValue() else { return String(display) }
        return CFUUIDCreateString(nil, uuid) as String
    }

    /// The screens that get a panel: by default only the notched (else built-in, else main) screen.
    static func targetScreens() -> [NSScreen] {
        let screens = NSScreen.screens
        if UserDefaults.standard.string(forKey: "panel.screens") == "all" { return screens }
        let preferred = screens.first { $0.safeAreaInsets.top > 0 }
            ?? screens.first { CGDisplayIsBuiltin(displayId($0)) != 0 }
            ?? NSScreen.main
            ?? screens.first
        return preferred.map { [$0] } ?? []
    }
}
