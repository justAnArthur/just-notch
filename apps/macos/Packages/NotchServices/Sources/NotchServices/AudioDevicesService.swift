import CoreAudio
import Foundation

/// `audioDevices` topic and `audio.setDevice`: the Mac's speakers, headphones and microphones, which ones are in use,
/// and whether an app is recording (a call). Reading device names and transports needs no permission.
@MainActor
public final class AudioDevicesService: NotchService {
    public let topics = ["audioDevices"]
    public let methods = ["audio.setDevice"]
    public weak var sink: ServiceSink?

    private var running = false
    private var latest = Latest<AudioDevices>()
    private var stopMicrophone: (() -> Void)?
    private lazy var listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        MainActor.assumeIsolated { self?.refresh() }
    }

    private static let systemAddresses = [
        AudioObjectPropertyAddress(selector: kAudioHardwarePropertyDevices, scope: kAudioObjectPropertyScopeGlobal),
        AudioObjectPropertyAddress(selector: kAudioHardwarePropertyDefaultOutputDevice, scope: kAudioObjectPropertyScopeGlobal),
        AudioObjectPropertyAddress(selector: kAudioHardwarePropertyDefaultInputDevice, scope: kAudioObjectPropertyScopeGlobal),
    ]

    public init() {}

    public func start(topic: String) {
        guard !running else { return }
        running = true
        for var address in Self.systemAddresses {
            AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, listener)
        }
        stopMicrophone = Presence.watchMicrophone { Task { @MainActor [weak self] in self?.refresh() } }
        refresh()
    }

    public func stop(topic: String) {
        guard running else { return }
        running = false
        for var address in Self.systemAddresses {
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, listener)
        }
        stopMicrophone?()
        stopMicrophone = nil
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        Self.read().json()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "audio.setDevice" else { throw ServiceError("unknown method \(method)") }
        struct Params: Decodable {
            var id: String
            var kind: String
        }
        let params = try decode(Params.self, params)
        guard let device = Self.devices().first(where: { Self.uid($0) == params.id }) else { throw ServiceError("no such device") }
        let selector = params.kind == "input" ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice
        var address = AudioObjectPropertyAddress(selector: selector, scope: kAudioObjectPropertyScopeGlobal)
        var id = device
        guard AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &id) == noErr else {
            throw ServiceError("couldn't switch to that device")
        }
        if params.kind != "input" {
            // System sounds follow, as when you pick a device in Control Center.
            var system = AudioObjectPropertyAddress(selector: kAudioHardwarePropertyDefaultSystemOutputDevice, scope: kAudioObjectPropertyScopeGlobal)
            _ = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &system, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &id)
        }
        refresh()
        return nil
    }

    private func refresh() {
        guard running else { return }
        let state = Self.read()
        guard latest.update(state), let data = state.json() else { return }
        sink?.publish(topic: "audioDevices", value: data)
    }

    static func read() -> AudioDevices {
        let all = devices()
        let outputs = all.filter { hasStreams($0, scope: kAudioDevicePropertyScopeOutput) }.compactMap(describe)
        let inputs = all.filter { hasStreams($0, scope: kAudioDevicePropertyScopeInput) }.compactMap(describe)
        return AudioDevices(
            outputs: outputs,
            inputs: inputs,
            output: defaultDevice(kAudioHardwarePropertyDefaultOutputDevice).flatMap(uid),
            input: defaultDevice(kAudioHardwarePropertyDefaultInputDevice).flatMap(uid),
            micInUse: Presence.microphoneInUse()
        )
    }

    private static func devices() -> [AudioObjectID] {
        var address = AudioObjectPropertyAddress(selector: kAudioHardwarePropertyDevices, scope: kAudioObjectPropertyScopeGlobal)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids
    }

    private static func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(selector: selector, scope: kAudioObjectPropertyScopeGlobal)
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    private static func hasStreams(_ device: AudioObjectID, scope: AudioObjectPropertyScope) -> Bool {
        var address = AudioObjectPropertyAddress(selector: kAudioDevicePropertyStreams, scope: scope)
        var size: UInt32 = 0
        return AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr && size > 0
    }

    private static func string(_ device: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(selector: selector, scope: kAudioObjectPropertyScopeGlobal)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }

    private static func uid(_ device: AudioObjectID) -> String? {
        string(device, kAudioDevicePropertyDeviceUID)
    }

    private static func transport(_ device: AudioObjectID) -> AudioDevice.Transport {
        var address = AudioObjectPropertyAddress(selector: kAudioDevicePropertyTransportType, scope: kAudioObjectPropertyScopeGlobal)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return .other }
        return AudioDevice.Transport(code: value)
    }

    private static func describe(_ device: AudioObjectID) -> AudioDevice? {
        guard let id = uid(device) else { return nil }
        let transport = transport(device)
        // Aggregate and virtual devices made by apps (Zoom, Teams, loopback tools) aren't something to pick here.
        guard transport != .aggregate else { return nil }
        return AudioDevice(id: id, name: string(device, kAudioObjectPropertyName) ?? id, transport: transport)
    }
}

/// bridge-schema `AudioDevices`.
public struct AudioDevices: Codable, Equatable, Sendable {
    public var outputs: [AudioDevice]
    public var inputs: [AudioDevice]
    /// The ids of the default output and input.
    public var output: String?
    public var input: String?
    public var micInUse: Bool
}

/// bridge-schema `AudioDevice`.
public struct AudioDevice: Codable, Equatable, Sendable {
    public enum Transport: String, Codable, Sendable {
        case builtIn, bluetooth, usb, hdmi, displayPort, airPlay, virtual, aggregate, other

        init(code: UInt32) {
            switch code {
            case kAudioDeviceTransportTypeBuiltIn: self = .builtIn
            case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: self = .bluetooth
            case kAudioDeviceTransportTypeUSB: self = .usb
            case kAudioDeviceTransportTypeHDMI: self = .hdmi
            case kAudioDeviceTransportTypeDisplayPort: self = .displayPort
            case kAudioDeviceTransportTypeAirPlay: self = .airPlay
            case kAudioDeviceTransportTypeVirtual: self = .virtual
            case kAudioDeviceTransportTypeAggregate, kAudioDeviceTransportTypeAutoAggregate: self = .aggregate
            default: self = .other
            }
        }
    }

    public var id: String
    public var name: String
    public var transport: Transport
}
