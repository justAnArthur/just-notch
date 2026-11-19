import AppKit

/// `windows.front` and `windows.setFrame`: the front app's focused window through Accessibility. Frames are global
/// points with the origin at the top left of the main screen, y down, as Accessibility gives them.
@MainActor
public final class WindowsService: NotchService {
    public let methods = ["windows.front", "windows.setFrame"]
    public weak var sink: ServiceSink?

    public init() {}

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "windows.front":
            let (app, window) = try focusedWindow()
            guard let frame = frame(of: window) else { throw ServiceError("the window has no frame") }
            let screens = NSScreen.screens.map { Self.flip($0.visibleFrame) }
            return FrontWindow(
                app: app.localizedName ?? "",
                pid: Int(app.processIdentifier),
                title: string(window, kAXTitleAttribute) ?? "",
                frame: Rect(frame),
                screen: Self.screenIndex(for: frame, in: screens),
                screens: screens.map(Rect.init)
            ).json()
        case "windows.setFrame":
            let target = try decode(SetFrameParams.self, params).frame
            let (app, window) = try focusedWindow()
            setFrame(window, app: app, to: CGRect(x: target.x, y: target.y, width: target.w, height: target.h))
            return nil
        default:
            throw ServiceError("unknown method \(method)")
        }
    }

    private static var askedForAccessibility = false

    /// The focused window of the app in front; the launcher's panel never activates Just Notch, so that's the
    /// app the user was in.
    private func focusedWindow() throws -> (NSRunningApplication, AXUIElement) {
        guard AXIsProcessTrusted() else {
            if !Self.askedForAccessibility {
                Self.askedForAccessibility = true
                AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
            }
            throw ServiceError("Just Notch needs Accessibility to move windows: allow it in System Settings › Privacy & Security")
        }
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != getpid() else {
            throw ServiceError("no app in front")
        }
        let element = AXUIElementCreateApplication(app.processIdentifier)
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &value) != .success {
            AXUIElementCopyAttributeValue(element, kAXMainWindowAttribute as CFString, &value)
        }
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else {
            throw ServiceError("\(app.localizedName ?? "The app in front") has no window")
        }
        return (app, value as! AXUIElement)
    }

    private func frame(of window: AXUIElement) -> CGRect? {
        var position = CGPoint.zero
        var size = CGSize.zero
        guard let p = attribute(window, kAXPositionAttribute), AXValueGetValue(p, .cgPoint, &position),
              let s = attribute(window, kAXSizeAttribute), AXValueGetValue(s, .cgSize, &size)
        else { return nil }
        return CGRect(origin: position, size: size)
    }

    /// Size, position, then size again: a window too large for the screen it's leaving can't move until it
    /// shrinks, and one moving to a larger screen can't grow until it has moved.
    private func setFrame(_ window: AXUIElement, app: NSRunningApplication, to frame: CGRect) {
        // With enhanced UI on (VoiceOver, some Electron and Chromium apps) the app animates every step, slowly.
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let enhanced = "AXEnhancedUserInterface" as CFString
        var was: CFTypeRef?
        let wasEnhanced = AXUIElementCopyAttributeValue(appElement, enhanced, &was) == .success && (was as? Bool) == true
        if wasEnhanced { AXUIElementSetAttributeValue(appElement, enhanced, kCFBooleanFalse) }
        defer { if wasEnhanced { AXUIElementSetAttributeValue(appElement, enhanced, kCFBooleanTrue) } }

        var size = frame.size
        var origin = frame.origin
        let sizeValue = AXValueCreate(.cgSize, &size)!
        let originValue = AXValueCreate(.cgPoint, &origin)!
        AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
        AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, originValue)
        AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
    }

    private func attribute(_ element: AXUIElement, _ name: String) -> AXValue? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success, let value,
              CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
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
    var pid: Int
    var title: String
    var frame: Rect
    var screen: Int
    var screens: [Rect]
}

private struct SetFrameParams: Decodable {
    var frame: Rect
}
