import AppKit
import ApplicationServices
import CoreGraphics

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

/// Media key codes in an `NX_SYSDEFINED` aux-control event (IOKit `ev_keymap.h`).
enum MediaKey: Int {
    case soundUp = 0
    case soundDown = 1
    case brightnessUp = 2
    case brightnessDown = 3
    case mute = 7
    case illuminationUp = 21
    case illuminationDown = 22

    struct Press: Equatable {
        let key: MediaKey
        let down: Bool
    }

    /// Splits `NSEvent.data1` of a subtype-8 system-defined event.
    static func press(data1: Int) -> Press? {
        guard let key = MediaKey(rawValue: (data1 & 0xFFFF_0000) >> 16) else { return nil }
        return Press(key: key, down: (data1 & 0xFF00) >> 8 == 0x0A)
    }
}

/// `hud.setEnabled`: replaces the system volume / brightness HUD with `hud` events.
@MainActor
public final class HUDService: NotchService {
    public let methods = ["hud.setEnabled"]
    public weak var sink: ServiceSink?

    private var tap: CFMachPort?
    private var source: CFRunLoopSource?

    private static let systemDefined = CGEventType(rawValue: 14)!

    public init() {}

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "hud.setEnabled" else { throw ServiceError("unknown method \(method)") }
        let enabled = try decode(EnabledParams.self, params).enabled
        return EnabledResult(enabled: enabled ? enable() : disable()).json()
    }

    private func enable() -> Bool {
        if tap != nil { return true }
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else { return false }

        let mask = CGEventMask(1) << Self.systemDefined.rawValue
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let service = Unmanaged<HUDService>.fromOpaque(context).takeUnretainedValue()
                return MainActor.assumeIsolated { service.intercept(type: type, event: event) }
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return false }

        self.tap = tap
        source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    private func disable() -> Bool {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil
        source = nil
        return false
    }

    private func intercept(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        guard type == Self.systemDefined,
              let nsEvent = NSEvent(cgEvent: event),
              nsEvent.subtype.rawValue == 8,
              let press = MediaKey.press(data1: nsEvent.data1) else { return Unmanaged.passUnretained(event) }

        let fine = nsEvent.modifierFlags.contains(.option) && nsEvent.modifierFlags.contains(.shift)
        guard handled(press.key) else { return Unmanaged.passUnretained(event) }
        if press.down { apply(press.key, step: fine ? 1.0 / 64 : 1.0 / 16) }
        return nil
    }

    /// Whether this Mac can act on the key itself; otherwise the system keeps it.
    private func handled(_ key: MediaKey) -> Bool {
        switch key {
        case .soundUp, .soundDown, .mute: AudioOutput.canSetVolume()
        case .brightnessUp, .brightnessDown: Brightness.get() != nil
        case .illuminationUp, .illuminationDown: KeyboardBacklight.get() != nil
        }
    }

    private func apply(_ key: MediaKey, step: Double) {
        switch key {
        case .soundUp, .soundDown:
            let current = AudioOutput.state()?.volume ?? 0
            AudioOutput.setVolume(Self.stepped(current, by: key == .soundUp ? step : -step, step: step))
            emitVolume()
        case .mute:
            AudioOutput.setMuted(!(AudioOutput.state()?.muted ?? false))
            emitVolume()
        case .brightnessUp, .brightnessDown:
            let next = Self.stepped(Brightness.get() ?? 0, by: key == .brightnessUp ? step : -step, step: step)
            Brightness.set(next)
            emit(HUDEvent(kind: .brightness, value: Brightness.get() ?? next))
        case .illuminationUp, .illuminationDown:
            let next = Self.stepped(KeyboardBacklight.get() ?? 0, by: key == .illuminationUp ? step : -step, step: step)
            KeyboardBacklight.set(next)
            emit(HUDEvent(kind: .keyboard, value: next))
        }
    }

    /// Moves `value` by `delta`, snapping to the step grid so repeated presses land on even steps.
    static func stepped(_ value: Double, by delta: Double, step: Double) -> Double {
        let snapped = ((value + delta) / step).rounded() * step
        return min(1, max(0, snapped))
    }

    private func emitVolume() {
        guard let state = AudioOutput.state() else { return }
        emit(HUDEvent(kind: .volume, value: state.volume, muted: state.muted))
    }

    private func emit(_ event: HUDEvent) {
        guard let data = event.json() else { return }
        sink?.emit(event: "hud", payload: data)
    }
}
