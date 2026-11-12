import AudioToolbox
import CoreAudio
import Foundation

/// The default output device through CoreAudio; shared by AudioService and HUDService.
enum AudioOutput {
    static func defaultDevice() -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(selector: kAudioHardwarePropertyDefaultOutputDevice, scope: kAudioObjectPropertyScopeGlobal)
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    static func state() -> AudioState? {
        guard let device = defaultDevice() else { return nil }
        return AudioState(volume: volume(device), muted: muted(device), outputDevice: name(device))
    }

    static func volume(_ device: AudioObjectID) -> Double {
        var address = AudioObjectPropertyAddress(selector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, scope: kAudioDevicePropertyScopeOutput)
        var value = Float32(0)
        var size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectHasProperty(device, &address), AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return 0 }
        return (Double(value) * 1000).rounded() / 1000
    }

    static func muted(_ device: AudioObjectID) -> Bool {
        var address = AudioObjectPropertyAddress(selector: kAudioDevicePropertyMute, scope: kAudioDevicePropertyScopeOutput)
        var value = UInt32(0)
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectHasProperty(device, &address), AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return false }
        return value != 0
    }

    static func name(_ device: AudioObjectID) -> String {
        var address = AudioObjectPropertyAddress(selector: kAudioObjectPropertyName, scope: kAudioObjectPropertyScopeGlobal)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr, let value else { return "" }
        return value.takeRetainedValue() as String
    }

    static func canSetVolume() -> Bool {
        guard let device = defaultDevice() else { return false }
        var address = AudioObjectPropertyAddress(selector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, scope: kAudioDevicePropertyScopeOutput)
        var settable: DarwinBoolean = false
        return AudioObjectHasProperty(device, &address) && AudioObjectIsPropertySettable(device, &address, &settable) == noErr && settable.boolValue
    }

    @discardableResult
    static func setVolume(_ volume: Double) -> Bool {
        guard let device = defaultDevice() else { return false }
        var address = AudioObjectPropertyAddress(selector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, scope: kAudioDevicePropertyScopeOutput)
        var value = Float32(min(1, max(0, volume)))
        guard AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<Float32>.size), &value) == noErr else { return false }
        if value > 0, muted(device) { setMuted(false) }
        return true
    }

    @discardableResult
    static func setMuted(_ muted: Bool) -> Bool {
        guard let device = defaultDevice() else { return false }
        var address = AudioObjectPropertyAddress(selector: kAudioDevicePropertyMute, scope: kAudioDevicePropertyScopeOutput)
        var value = UInt32(muted ? 1 : 0)
        return AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value) == noErr
    }
}

extension AudioObjectPropertyAddress {
    init(selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope) {
        self.init(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }
}

/// `audio` topic and `audio.setVolume`.
@MainActor
public final class AudioService: NotchService {
    public let topics = ["audio"]
    public let methods = ["audio.setVolume"]
    public weak var sink: ServiceSink?

    private var running = false
    private var observedDevice: AudioObjectID?
    private var latest = Latest<AudioState>()
    private lazy var listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        MainActor.assumeIsolated { self?.refresh() }
    }
    private lazy var deviceListener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        MainActor.assumeIsolated {
            self?.observeDefaultDevice()
            self?.refresh()
        }
    }

    private static let deviceAddresses = [
        AudioObjectPropertyAddress(selector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume, scope: kAudioDevicePropertyScopeOutput),
        AudioObjectPropertyAddress(selector: kAudioDevicePropertyMute, scope: kAudioDevicePropertyScopeOutput),
        AudioObjectPropertyAddress(selector: kAudioObjectPropertyName, scope: kAudioObjectPropertyScopeGlobal),
    ]
    private static let defaultDeviceAddress = AudioObjectPropertyAddress(selector: kAudioHardwarePropertyDefaultOutputDevice, scope: kAudioObjectPropertyScopeGlobal)

    public init() {}

    public func start(topic: String) {
        guard !running else { return }
        running = true
        var address = Self.defaultDeviceAddress
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, deviceListener)
        observeDefaultDevice()
        refresh()
    }

    public func stop(topic: String) {
        guard running else { return }
        running = false
        var address = Self.defaultDeviceAddress
        AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, deviceListener)
        unobserveDevice()
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        AudioOutput.state()?.json()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "audio.setVolume" else { throw ServiceError("unknown method \(method)") }
        let volume = try decode(VolumeParams.self, params).volume
        guard AudioOutput.setVolume(volume) else { throw ServiceError("output device has no settable volume") }
        return nil
    }

    private func observeDefaultDevice() {
        let device = AudioOutput.defaultDevice()
        guard device != observedDevice else { return }
        unobserveDevice()
        guard let device else { return }
        observedDevice = device
        for var address in Self.deviceAddresses where AudioObjectHasProperty(device, &address) {
            AudioObjectAddPropertyListenerBlock(device, &address, .main, listener)
        }
    }

    private func unobserveDevice() {
        guard let device = observedDevice else { return }
        for var address in Self.deviceAddresses {
            AudioObjectRemovePropertyListenerBlock(device, &address, .main, listener)
        }
        observedDevice = nil
    }

    private func refresh() {
        guard running, let state = AudioOutput.state(), latest.update(state), let data = state.json() else { return }
        sink?.publish(topic: "audio", value: data)
    }
}
