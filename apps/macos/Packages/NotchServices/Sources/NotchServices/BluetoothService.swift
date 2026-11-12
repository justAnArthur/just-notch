import Foundation
import IOBluetooth
import IOKit

enum BluetoothKind {
    /// Bluetooth Class of Device, major and minor (Assigned Numbers, Baseband).
    static func kind(major: UInt32, minor: UInt32) -> BluetoothDevice.Kind {
        switch major {
        case 0x04:
            switch minor {
            case 0x01, 0x02, 0x06: return .headphones
            case 0x05, 0x07, 0x0A: return .speaker
            default: return .other
            }
        case 0x05:
            if minor & 0x10 != 0 { return .keyboard }
            if minor & 0x20 != 0 { return .mouse }
            return .other
        default:
            return .other
        }
    }
}

/// Battery of Apple HID accessories (Magic Keyboard, Mouse, Trackpad) from the
/// IORegistry, keyed by normalized Bluetooth address. AirPods aren't listed there.
enum BluetoothBattery {
    static func levels() -> [String: Double] {
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleDeviceManagementHIDEventService"), &iterator) == KERN_SUCCESS else { return [:] }
        defer { IOObjectRelease(iterator) }

        var levels: [String: Double] = [:]
        while case let service = IOIteratorNext(iterator), service != 0 {
            defer { IOObjectRelease(service) }
            guard let address = property(service, "DeviceAddress") as? String,
                  let percent = property(service, "BatteryPercent") as? NSNumber else { continue }
            levels[normalize(address)] = percent.doubleValue
        }
        return levels
    }

    static func normalize(_ address: String) -> String {
        address.lowercased().replacingOccurrences(of: ":", with: "-")
    }

    private static func property(_ service: io_object_t, _ key: String) -> Any? {
        IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
    }
}

/// `bluetooth` topic (paired devices) and the `bluetooth.connected` event.
@MainActor
public final class BluetoothService: NotchService {
    public let topics = ["bluetooth"]
    public weak var sink: ServiceSink?

    private var observer: Observer?
    private var connectNotification: IOBluetoothUserNotification?
    private var disconnectNotifications: [String: IOBluetoothUserNotification] = [:]
    private var latest = Latest<[BluetoothDevice]>()

    public init() {}

    public func start(topic: String) {
        guard observer == nil else { return }
        let observer = Observer(service: self)
        self.observer = observer
        refresh()
        connectNotification = IOBluetoothDevice.register(forConnectNotifications: observer, selector: #selector(Observer.connected(_:device:)))
    }

    public func stop(topic: String) {
        connectNotification?.unregister()
        connectNotification = nil
        disconnectNotifications.values.forEach { $0.unregister() }
        disconnectNotifications = [:]
        observer = nil
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        Self.devices().json()
    }

    fileprivate func connected(_ device: IOBluetoothDevice) {
        let id = BluetoothBattery.normalize(device.addressString ?? "")
        let wasConnected = latest.value?.first { $0.id == id }?.connected ?? false
        refresh()
        guard !wasConnected, let info = Self.describe(device, batteries: BluetoothBattery.levels()), let data = info.json() else { return }
        sink?.emit(event: "bluetooth.connected", payload: data)
    }

    fileprivate func disconnected(_ device: IOBluetoothDevice) {
        if let id = device.addressString { disconnectNotifications.removeValue(forKey: id)?.unregister() }
        refresh()
    }

    private func refresh() {
        guard let observer else { return }
        let paired = Self.paired()
        for device in paired where device.isConnected() {
            guard let id = device.addressString, disconnectNotifications[id] == nil else { continue }
            disconnectNotifications[id] = device.register(forDisconnectNotification: observer, selector: #selector(Observer.disconnected(_:device:)))
        }
        let batteries = BluetoothBattery.levels()
        let devices = paired.compactMap { Self.describe($0, batteries: batteries) }
        guard latest.update(devices), let data = devices.json() else { return }
        sink?.publish(topic: "bluetooth", value: data)
    }

    private static func paired() -> [IOBluetoothDevice] {
        IOBluetoothDevice.pairedDevices()?.compactMap { $0 as? IOBluetoothDevice } ?? []
    }

    private static func devices() -> [BluetoothDevice] {
        let batteries = BluetoothBattery.levels()
        return paired().compactMap { describe($0, batteries: batteries) }
    }

    private static func describe(_ device: IOBluetoothDevice, batteries: [String: Double]) -> BluetoothDevice? {
        guard let address = device.addressString else { return nil }
        let id = BluetoothBattery.normalize(address)
        return BluetoothDevice(
            id: id,
            name: device.nameOrAddress ?? address,
            kind: BluetoothKind.kind(major: device.deviceClassMajor, minor: device.deviceClassMinor),
            connected: device.isConnected(),
            batteryPercent: batteries[id]
        )
    }

    /// IOBluetooth notifies through Objective-C selectors.
    private final class Observer: NSObject {
        weak var service: BluetoothService?

        init(service: BluetoothService) { self.service = service }

        @objc func connected(_ notification: IOBluetoothUserNotification, device: IOBluetoothDevice) {
            MainActor.assumeIsolated { service?.connected(device) }
        }

        @objc func disconnected(_ notification: IOBluetoothUserNotification, device: IOBluetoothDevice) {
            MainActor.assumeIsolated { service?.disconnected(device) }
        }
    }
}
