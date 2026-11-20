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
            let frame = try frame(of: window, app: app)
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
            try setFrame(window, app: app, to: CGRect(x: target.x, y: target.y, width: target.w, height: target.h))
            return nil
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

    /// Size, position, then size again: a window too large for the screen it's leaving can't move until it
    /// shrinks, and one moving to a larger screen can't grow until it has moved. A window that won't resize (a
    /// fixed-size panel) still moves; one that won't move is an error.
    private func setFrame(_ window: AXUIElement, app: NSRunningApplication, to frame: CGRect) throws {
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
        let first = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
        let moved = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, originValue)
        let sized = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
        for code in [first, moved, sized] where code == .apiDisabled || code == .invalidUIElement {
            throw Self.error(code, app: app)
        }
        if moved != .success { throw Self.error(moved, app: app) }
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
    var pid: Int
    var title: String
    var frame: Rect
    var screen: Int
    var screens: [Rect]
}

private struct SetFrameParams: Decodable {
    var frame: Rect
}
