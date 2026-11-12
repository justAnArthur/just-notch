import CoreGraphics
import Foundation

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

/// `display.setBrightness` for the built-in display.
@MainActor
public final class DisplayService: NotchService {
    public let methods = ["display.setBrightness"]
    public weak var sink: ServiceSink?

    public init() {}

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "display.setBrightness" else { throw ServiceError("unknown method \(method)") }
        let brightness = try decode(BrightnessParams.self, params).brightness
        guard Brightness.set(brightness) else { throw ServiceError("brightness is not controllable on this display") }
        return nil
    }
}
