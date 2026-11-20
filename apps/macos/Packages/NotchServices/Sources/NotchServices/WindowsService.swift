import AppKit

/// `windows.front` and `windows.setFrame`: the front app's focused window through Accessibility. Frames are global
/// points with the origin at the top left of the main screen, y down, as Accessibility gives them. Also
/// `windows.tiling` (macOS's own tiling settings, read only) and the `frontApp` topic.
@MainActor
public final class WindowsService: NotchService {
    public let methods = ["windows.front", "windows.setFrame", "windows.tiling"]
    public let topics = ["frontApp"]
    public weak var sink: ServiceSink?
    private var activation: NSObjectProtocol?

    public init() {}

    public func start(topic: String) {
        activation = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let value = Self.frontApp().json() else { return }
                self.sink?.publish(topic: "frontApp", value: value)
            }
        }
    }

    public func stop(topic: String) {
        if let activation { NSWorkspace.shared.notificationCenter.removeObserver(activation) }
        activation = nil
    }

    public func snapshot(topic: String) async -> Data? {
        Self.frontApp().json()
    }

    /// Encodes as `null` when nothing (or Just Notch itself) is in front.
    static func frontApp() -> FrontApp? {
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != getpid() else { return nil }
        return FrontApp(bundleId: app.bundleIdentifier ?? "", name: app.localizedName ?? "")
    }

    /// macOS 15's tiling settings (Desktop & Dock › Windows), on unless the user turned them off; none before 15.
    /// Read, never written: changing Apple's defaults behind the user's back is theirs to do.
    static func tiling(_ read: (String) -> Any? = { CFPreferencesCopyAppValue($0 as CFString, "com.apple.WindowManager" as CFString) },
                       macOS15: Bool = ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 15, minorVersion: 0, patchVersion: 0))) -> MacTiling {
        func on(_ key: String) -> Bool { macOS15 && (read(key) as? Bool ?? true) }
        return MacTiling(edgeDrag: on("EnableTilingByEdgeDrag"), topEdgeDrag: on("EnableTopTilingByEdgeDrag"),
                         optionDrag: on("EnableTilingOptionAccelerator"), margins: on("EnableTiledWindowMargins"))
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "windows.front":
            let (app, window) = try focusedWindow()
            let frame = try frame(of: window, app: app)
            let screens = NSScreen.screens.map { Self.flip($0.visibleFrame) }
            return FrontWindow(
                app: app.localizedName ?? "",
                bundleId: app.bundleIdentifier ?? "",
                pid: Int(app.processIdentifier),
                title: string(window, kAXTitleAttribute) ?? "",
                frame: Rect(frame),
                screen: Self.screenIndex(for: frame, in: screens),
                screens: screens.map(Rect.init)
            ).json()
        case "windows.setFrame":
            let p = try decode(SetFrameParams.self, params)
            let (app, window) = try focusedWindow()
            try await setFrame(window, app: app, to: CGRect(x: p.frame.x, y: p.frame.y, width: p.frame.w, height: p.frame.h), animate: p.animate ?? true)
            return nil
        case "windows.tiling":
            return Self.tiling().json()
        default:
            throw ServiceError("unknown method \(method)")
        }
    }

    private static var askedForAccessibility = false

    /// The one message for a missing or stale grant, so the plugin (and the Fix row) can tell it from the rest.
    static let accessibilityMessage = "Just Notch needs Accessibility to move windows: allow it in System Settings › Privacy & Security › Accessibility"

    /// A failed Accessibility call in words. `.apiDisabled` also comes from a grant that's still listed but no
    /// longer matches the app (a reinstall or re-signed build), so it says to switch it off and on again.
    static func error(_ code: AXError, app: NSRunningApplication) -> ServiceError {
        let name = app.localizedName ?? "The app in front"
        switch code {
        case .apiDisabled:
            return ServiceError(accessibilityMessage + ". If it's already on, turn it off and on again.")
        case .invalidUIElement:
            return ServiceError("The window closed")
        case .cannotComplete:
            return ServiceError("\(name) didn't answer")
        case .attributeUnsupported, .notImplemented, .actionUnsupported:
            return ServiceError("\(name) doesn't let its windows be moved")
        default:
            return ServiceError("Couldn't move the window (AXError \(code.rawValue))")
        }
    }

    /// The focused window of the app in front; the launcher's panel never activates Just Notch, so that's the
    /// app the user was in.
    private func focusedWindow() throws -> (NSRunningApplication, AXUIElement) {
        guard AXIsProcessTrusted() else {
            // The system's prompt the first time; after that the Accessibility list itself, so a move never just
            // does nothing.
            if !Self.askedForAccessibility {
                Self.askedForAccessibility = true
                AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
            } else if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                NSWorkspace.shared.open(url)
            }
            throw ServiceError(Self.accessibilityMessage)
        }
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != getpid() else {
            throw ServiceError("no app in front")
        }
        let element = AXUIElementCreateApplication(app.processIdentifier)
        var value: CFTypeRef?
        var code = AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &value)
        if code != .success {
            code = AXUIElementCopyAttributeValue(element, kAXMainWindowAttribute as CFString, &value)
        }
        if code == .apiDisabled { throw Self.error(code, app: app) }
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else {
            throw ServiceError("\(app.localizedName ?? "The app in front") has no window")
        }
        return (app, value as! AXUIElement)
    }

    private func frame(of window: AXUIElement, app: NSRunningApplication) throws -> CGRect {
        var position = CGPoint.zero
        var size = CGSize.zero
        let p = try attribute(window, kAXPositionAttribute, app: app)
        let s = try attribute(window, kAXSizeAttribute, app: app)
        guard AXValueGetValue(p, .cgPoint, &position), AXValueGetValue(s, .cgSize, &size) else {
            throw ServiceError("the window has no frame")
        }
        return CGRect(origin: position, size: size)
    }

    /// How long a move takes, and how often it steps: macOS's own tiling takes about this long.
    static let duration: TimeInterval = 0.2
    private static let frameInterval: TimeInterval = 1.0 / 60
    /// A step slower than this means an app that redraws on every set (Chromium, Electron): jump to the end.
    private static let slowStep: TimeInterval = 0.025
    /// Bumped by every move, so an older animation stops when a newer move starts.
    private var generation = 0

    /// Whether a move from `from` to `to` animates: not with Reduce Motion, nor for a few points.
    static func animates(from: CGRect, to: CGRect, reduceMotion: Bool) -> Bool {
        guard !reduceMotion else { return false }
        let delta = [from.minX - to.minX, from.minY - to.minY, from.width - to.width, from.height - to.height]
        return delta.contains { abs($0) > 4 }
    }

    /// The frame `t` (0…1) of the way from `from` to `to`, eased out (fast start, soft landing), in whole points.
    static func interpolate(from: CGRect, to: CGRect, t: Double) -> CGRect {
        let e = 1 - pow(1 - min(max(t, 0), 1), 3)
        func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { (a + (b - a) * e).rounded() }
        return CGRect(x: mix(from.minX, to.minX), y: mix(from.minY, to.minY), width: mix(from.width, to.width), height: mix(from.height, to.height))
    }

    /// Steps the window toward `frame`, then sets it: size, position, then size again, since a window too large
    /// for the screen it's leaving can't move until it shrinks, and one moving to a larger screen can't grow until
    /// it has moved. A window that won't resize (a fixed-size panel) still moves; one that won't move is an error.
    private func setFrame(_ window: AXUIElement, app: NSRunningApplication, to frame: CGRect, animate: Bool) async throws {
        generation += 1
        let mine = generation
        // With enhanced UI on (VoiceOver, some Electron and Chromium apps) the app animates every step, slowly.
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let enhanced = "AXEnhancedUserInterface" as CFString
        var was: CFTypeRef?
        let wasEnhanced = AXUIElementCopyAttributeValue(appElement, enhanced, &was) == .success && (was as? Bool) == true
        if wasEnhanced { AXUIElementSetAttributeValue(appElement, enhanced, kCFBooleanFalse) }
        defer { if wasEnhanced { AXUIElementSetAttributeValue(appElement, enhanced, kCFBooleanTrue) } }

        let reduceMotion = !animate || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if !wasEnhanced, let start = try? self.frame(of: window, app: app), Self.animates(from: start, to: frame, reduceMotion: reduceMotion) {
            let began = Date()
            while true {
                try? await Task.sleep(for: .seconds(Self.frameInterval))
                // A newer move owns the window now; it sets the final frame.
                guard generation == mine else { return }
                let t = Date().timeIntervalSince(began) / Self.duration
                if t >= 1 { break }
                let step = Self.interpolate(from: start, to: frame, t: t)
                let stepBegan = Date()
                let code = set(window, kAXPositionAttribute, point: step.origin)
                if code == .apiDisabled || code == .invalidUIElement { throw Self.error(code, app: app) }
                if code != .success { break }
                _ = set(window, kAXSizeAttribute, size: step.size)
                if Date().timeIntervalSince(stepBegan) > Self.slowStep { break }
            }
        }
        guard generation == mine else { return }

        let first = set(window, kAXSizeAttribute, size: frame.size)
        let moved = set(window, kAXPositionAttribute, point: frame.origin)
        let sized = set(window, kAXSizeAttribute, size: frame.size)
        for code in [first, moved, sized] where code == .apiDisabled || code == .invalidUIElement {
            throw Self.error(code, app: app)
        }
        if moved != .success { throw Self.error(moved, app: app) }
    }

    private func set(_ window: AXUIElement, _ name: String, point: CGPoint) -> AXError {
        var point = point
        return AXUIElementSetAttributeValue(window, name as CFString, AXValueCreate(.cgPoint, &point)!)
    }

    private func set(_ window: AXUIElement, _ name: String, size: CGSize) -> AXError {
        var size = size
        return AXUIElementSetAttributeValue(window, name as CFString, AXValueCreate(.cgSize, &size)!)
    }

    private func attribute(_ element: AXUIElement, _ name: String, app: NSRunningApplication) throws -> AXValue {
        var value: CFTypeRef?
        let code = AXUIElementCopyAttributeValue(element, name as CFString, &value)
        guard code == .success else { throw Self.error(code, app: app) }
        guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { throw ServiceError("the window has no frame") }
        return (value as! AXValue)
    }

    private func string(_ element: AXUIElement, _ name: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? String
    }

    /// A Cocoa rect (origin bottom left of the main screen, y up) in Accessibility's space.
    private static func flip(_ rect: CGRect) -> CGRect {
        let main = NSScreen.screens.first?.frame.height ?? 0
        return CGRect(x: rect.minX, y: main - rect.maxY, width: rect.width, height: rect.height)
    }

    /// The screen holding most of the window.
    private static func screenIndex(for frame: CGRect, in screens: [CGRect]) -> Int {
        let areas = screens.map { s -> CGFloat in
            let i = s.intersection(frame)
            return i.isNull ? 0 : i.width * i.height
        }
        return areas.indices.max { areas[$0] < areas[$1] } ?? 0
    }
}

private struct Rect: Codable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double

    init(_ r: CGRect) {
        x = r.minX; y = r.minY; w = r.width; h = r.height
    }
}

private struct FrontWindow: Encodable {
    var app: String
    var bundleId: String
    var pid: Int
    var title: String
    var frame: Rect
    var screen: Int
    var screens: [Rect]
}

private struct SetFrameParams: Decodable {
    var frame: Rect
    var animate: Bool?
}

struct FrontApp: Encodable {
    var bundleId: String
    var name: String
}

struct MacTiling: Encodable, Equatable {
    var edgeDrag: Bool
    var topEdgeDrag: Bool
    var optionDrag: Bool
    var margins: Bool
}
