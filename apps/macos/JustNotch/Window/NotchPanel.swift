import AppKit

/// Borderless, transparent, non-activating panel above the menu bar on every space.
final class NotchPanel: NSPanel {
    /// Set by `window.setFocusable`: the runtime lets the panel become key while expanded.
    var focusable = false {
        didSet {
            if !focusable, !launcher, isKeyWindow { resignKey() }
        }
    }

    /// The launcher is open on this panel: it takes the keyboard whatever the island's state.
    var launcher = false

    override var canBecomeKey: Bool { focusable || launcher }
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
        // Kept out of screen shares and recordings, where the island would only distract.
        sharingType = .none
    }

    /// The default keeps windows below the menu bar; the panel's top edge must be flush with the screen top.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

enum ScreenLayout {
    /// Room for the island's tall sheet (560) below the notch, and for the launcher's search row; the panel is
    /// transparent and lets clicks through outside the island. Taller on most screens: see `height(_:)`.
    static let panelSize = NSSize(width: 800, height: 620)
    /// The launcher's pill rests here, about where Spotlight's sits: a fraction of the screen's height from its top.
    static let launcherTop = 0.38
    /// Below the pill: its row (56) and the results sheet.
    static let launcherBelow = 560.0

    /// Where the launcher's pill sits on `screen`, in panel coordinates (from the screen's top edge).
    static func launcherPillTop(_ screen: NSScreen) -> Double {
        (screen.frame.height * launcherTop).rounded()
    }

    /// From the screen's top past the launcher's results. Always this tall, never resized: resizing a web view
    /// relayouts and repaints the page, a stutter right as the launcher's drop starts. Transparent space is free.
    static func height(_ screen: NSScreen) -> Double {
        min(screen.frame.height, max(panelSize.height, launcherPillTop(screen) + launcherBelow))
    }
    static let virtualNotchWidth = 200.0
    static let virtualNotchHeight = 32.0

    /// The panel's frame on `screen` (centered on the notch, top edge flush) and its geometry.
    static func layout(_ screen: NSScreen) -> (frame: NSRect, geometry: ScreenGeometry) {
        let height = height(screen)
        let frame = screen.frame
        let notch = notchRect(screen)
        let size = NSSize(width: panelSize.width, height: height)
        let origin = NSPoint(x: (notch.midX - size.width / 2).rounded(), y: frame.maxY - size.height)
        let panelFrame = NSRect(origin: origin, size: size)
        let hasNotch = screen.safeAreaInsets.top > 0
        let geometry = ScreenGeometry(
            panel: .init(w: size.width, h: size.height),
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

    /// `panel.screens` in the app's defaults; anything but `all` means `notched`. Superseded by per-display modes,
    /// and still read for a display without one.
    static var screens: AppPreferences.Screens {
        get { UserDefaults.standard.string(forKey: "panel.screens") == "all" ? .all : .notched }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "panel.screens") }
    }

    /// What the island does on a display: nothing (`hidden`), keep to activities and hover (`pill`), or stay (`full`).
    enum DisplayMode: String, Codable {
        case hidden, pill, full
    }

    struct DisplayInfo: Codable, Equatable {
        var id: String
        var name: String
        var hasNotch: Bool
        var mode: DisplayMode
    }

    /// When the island steps aside on its own.
    struct HideWhen: Codable, Equatable {
        var fullScreen = true
        var calls = true
    }

    private static let modesKey = "panel.displayModes"
    private static let hideWhenKey = "panel.hideWhen"

    /// The modes the user chose, by display id.
    static var modes: [String: DisplayMode] {
        get {
            let raw = UserDefaults.standard.dictionary(forKey: modesKey) as? [String: String] ?? [:]
            return raw.compactMapValues(DisplayMode.init(rawValue:))
        }
        set { UserDefaults.standard.set(newValue.mapValues(\.rawValue), forKey: modesKey) }
    }

    /// Merges `changes` into the chosen modes.
    static func setModes(_ changes: [String: DisplayMode]) {
        modes.merge(changes) { $1 }
    }

    static var hideWhen: HideWhen {
        get {
            UserDefaults.standard.data(forKey: hideWhenKey).flatMap { try? JSONDecoder().decode(HideWhen.self, from: $0) } ?? HideWhen()
        }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: hideWhenKey) }
    }

    /// The display the island belongs on when nothing says otherwise: the notched, else built-in, else main one.
    private static func preferred(_ screens: [NSScreen]) -> NSScreen? {
        screens.first { $0.safeAreaInsets.top > 0 }
            ?? screens.first { CGDisplayIsBuiltin(displayId($0)) != 0 }
            ?? NSScreen.main
            ?? screens.first
    }

    /// A display's mode: the user's choice, else `full` on the preferred display (every display with the legacy
    /// `all`) and `hidden` elsewhere.
    static func mode(_ screen: NSScreen, among screens: [NSScreen] = NSScreen.screens) -> DisplayMode {
        mode(id: id(screen), preferred: preferred(screens).map(id) == id(screen), chosen: modes, legacyAll: Self.screens == .all)
    }

    static func mode(id: String, preferred: Bool, chosen: [String: DisplayMode], legacyAll: Bool) -> DisplayMode {
        chosen[id] ?? (preferred || legacyAll ? .full : .hidden)
    }

    /// Every connected display with its mode, for Settings.
    static func displays() -> [DisplayInfo] {
        let screens = NSScreen.screens
        return screens.map { DisplayInfo(id: id($0), name: $0.localizedName, hasNotch: $0.safeAreaInsets.top > 0, mode: mode($0, among: screens)) }
    }

    /// The screens that get a panel: those not `hidden`. With every display hidden the preferred one keeps its
    /// panel, island hidden, since the launcher drops out of a panel.
    static func targetScreens() -> [NSScreen] {
        let screens = NSScreen.screens
        let shown = screens.filter { mode($0, among: screens) != .hidden }
        if shown.isEmpty, let fallback = preferred(screens) { return [fallback] }
        return shown
    }
}
