import Foundation
import IOKit.ps

/// `power` topic plus the `power.plugged` event when AC state flips.
@MainActor
public final class PowerService: NotchService {
    public let topics = ["power"]
    public weak var sink: ServiceSink?

    private var runLoopSource: CFRunLoopSource?
    private var lowPowerObserver: NSObjectProtocol?
    private var latest = Latest<PowerState>()

    public init() {}

    public func start(topic: String) {
        guard runLoopSource == nil else { return }
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard let source = IOPSNotificationCreateRunLoopSource({ context in
            guard let context else { return }
            let service = Unmanaged<PowerService>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated { service.refresh() }
        }, context)?.takeRetainedValue() else { return }
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)

        lowPowerObserver = NotificationCenter.default.addObserver(
            forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refresh()
    }

    public func stop(topic: String) {
        if let runLoopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .defaultMode) }
        runLoopSource = nil
        if let lowPowerObserver { NotificationCenter.default.removeObserver(lowPowerObserver) }
        lowPowerObserver = nil
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        Self.read().json()
    }

    private func refresh() {
        let previous = latest.value
        let state = Self.read()
        guard latest.update(state) else { return }
        if let data = state.json() { sink?.publish(topic: "power", value: data) }
        if let previous, previous.pluggedIn != state.pluggedIn, let event = PluggedEvent(pluggedIn: state.pluggedIn).json() {
            sink?.emit(event: "power.plugged", payload: event)
        }
    }

    static func read() -> PowerState {
        let lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue()
        let providing = info.flatMap { IOPSGetProvidingPowerSourceType($0)?.takeUnretainedValue() as String? }
        let pluggedIn = providing == kIOPSACPowerValue

        let list = info.flatMap { IOPSCopyPowerSourcesList($0)?.takeRetainedValue() as? [CFTypeRef] } ?? []
        let battery = list.lazy
            .compactMap { IOPSGetPowerSourceDescription(info, $0)?.takeUnretainedValue() as? [String: Any] }
            .first { $0[kIOPSTypeKey] as? String == kIOPSInternalBatteryType }

        guard let battery else {
            return PowerState(percent: 100, charging: false, pluggedIn: true, minutesRemaining: nil, lowPowerMode: lowPowerMode, hasBattery: false)
        }

        let current = battery[kIOPSCurrentCapacityKey] as? Double ?? 0
        let max = battery[kIOPSMaxCapacityKey] as? Double ?? 100
        let charging = battery[kIOPSIsChargingKey] as? Bool ?? false
        let minutesKey = charging ? kIOPSTimeToFullChargeKey : kIOPSTimeToEmptyKey
        let minutes = battery[minutesKey] as? Double ?? -1
        let percent = max > 0 ? min(100, (current / max * 100).rounded()) : 0
        return PowerState(
            percent: percent,
            charging: charging,
            pluggedIn: pluggedIn,
            minutesRemaining: minutes > 0 ? minutes : nil,
            lowPowerMode: lowPowerMode,
            hasBattery: true
        )
    }
}
