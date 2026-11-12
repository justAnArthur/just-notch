import AppKit
import CoreGraphics

/// Built-in display brightness through the private DisplayServices framework,
/// loaded lazily; every call fails soft when the symbols are missing.
enum Brightness {
    private typealias Get = @convention(c) (CGDirectDisplayID, UnsafeMutablePointer<Float>) -> Int32
    private typealias Set = @convention(c) (CGDirectDisplayID, Float) -> Int32

    private struct Symbols {
        let get: Get
        let set: Set
    }

    private static let symbols: Symbols? = {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY),
              let get = dlsym(handle, "DisplayServicesGetBrightness"),
              let set = dlsym(handle, "DisplayServicesSetBrightness") else { return nil }
        return Symbols(get: unsafeBitCast(get, to: Get.self), set: unsafeBitCast(set, to: Set.self))
    }()

    static func builtInDisplay() -> CGDirectDisplayID? {
        var count: UInt32 = 0
        guard CGGetOnlineDisplayList(0, nil, &count) == .success, count > 0 else { return nil }
        var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetOnlineDisplayList(count, &displays, &count) == .success else { return nil }
        return displays.first { CGDisplayIsBuiltin($0) != 0 }
    }

    static func get() -> Double? {
        guard let symbols, let display = builtInDisplay() else { return nil }
        var value: Float = 0
        guard symbols.get(display, &value) == 0 else { return nil }
        return Double(value)
    }

    @discardableResult
    static func set(_ brightness: Double) -> Bool {
        guard let symbols, let display = builtInDisplay() else { return false }
        return symbols.set(display, Float(min(1, max(0, brightness)))) == 0
    }
}

/// The keyboard backlight through CoreBrightness' private `KeyboardBrightnessClient`, best effort.
enum KeyboardBacklight {
    private typealias Get = @convention(c) (AnyObject, Selector, UInt64) -> Float
    private typealias Set = @convention(c) (AnyObject, Selector, Float, UInt64) -> Bool
    private typealias IDs = @convention(c) (AnyObject, Selector) -> NSArray?

    private struct Client {
        let object: NSObject
        let id: UInt64
        let get: Get
        let set: Set
    }

    private static let client: Client? = {
        dlopen("/System/Library/PrivateFrameworks/CoreBrightness.framework/CoreBrightness", RTLD_LAZY)
        guard let type = NSClassFromString("KeyboardBrightnessClient") as? NSObject.Type else { return nil }
        let object = type.init()
        let getSel = NSSelectorFromString("brightnessForKeyboard:")
        let setSel = NSSelectorFromString("setBrightness:forKeyboard:")
        let idsSel = NSSelectorFromString("copyKeyboardBacklightIDs")
        guard object.responds(to: getSel), object.responds(to: setSel), object.responds(to: idsSel) else { return nil }
        let ids = unsafeBitCast(object.method(for: idsSel), to: IDs.self)(object, idsSel) as? [NSNumber]
        guard let id = ids?.first?.uint64Value else { return nil }
        return Client(
            object: object,
            id: id,
            get: unsafeBitCast(object.method(for: getSel), to: Get.self),
            set: unsafeBitCast(object.method(for: setSel), to: Set.self)
        )
    }()

    static func get() -> Double? {
        guard let client else { return nil }
        return Double(client.get(client.object, NSSelectorFromString("brightnessForKeyboard:"), client.id))
    }

    @discardableResult
    static func set(_ value: Double) -> Bool {
        guard let client else { return false }
        return client.set(client.object, NSSelectorFromString("setBrightness:forKeyboard:"), Float(min(1, max(0, value))), client.id)
    }
}

/// `display` topic, `display.setBrightness` and `display.setKeyboardBacklight`.
/// Neither value has a public change notification, so the topic polls while subscribed.
@MainActor
public final class DisplayService: NotchService {
    public let topics = ["display"]
    public let methods = ["display.setBrightness", "display.setKeyboardBacklight"]
    public weak var sink: ServiceSink?

    private static let interval: TimeInterval = 0.5
    private var timer: Timer?
    private var latest = Latest<DisplayState>()

    public init() {}

    public func start(topic: String) {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: Self.interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refresh()
    }

    public func stop(topic: String) {
        timer?.invalidate()
        timer = nil
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        Self.read()?.json()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "display.setBrightness":
            guard Brightness.set(try decode(BrightnessParams.self, params).brightness) else {
                throw ServiceError("brightness is not controllable on this display")
            }
        case "display.setKeyboardBacklight":
            guard KeyboardBacklight.set(try decode(LevelParams.self, params).level) else {
                throw ServiceError("this Mac has no controllable keyboard backlight")
            }
        default:
            throw ServiceError("unknown method \(method)")
        }
        if timer != nil { refresh() }
        return nil
    }

    /// nil without a built-in display whose brightness can be read.
    static func read() -> DisplayState? {
        guard let brightness = Brightness.get() else { return nil }
        return DisplayState(brightness: brightness, keyboardBacklight: KeyboardBacklight.get())
    }

    private func refresh() {
        guard let state = Self.read(), latest.update(state), let data = state.json() else { return }
        sink?.publish(topic: "display", value: data)
    }
}
