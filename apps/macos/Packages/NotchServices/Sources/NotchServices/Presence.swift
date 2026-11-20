import CoreAudio
import CoreGraphics
import Foundation

/// When the island should keep out of the way: a full-screen app on its screen, or a call.
public enum Presence {
    /// The screens (by id) another app covers edge to edge with a normal window: a full-screen Space, a full-screen
    /// video. `windows` is `CGWindowListCopyWindowInfo`'s list; `screens` are the screens' frames in its space
    /// (global, origin at the main screen's top left, y down). Bounds, layer and owner need no permission.
    public static func fullScreen(windows: [[String: Any]], screens: [String: CGRect], ownPid: pid_t) -> Set<String> {
        var covered = Set<String>()
        for window in windows {
            guard (window[kCGWindowLayer as String] as? Int) == 0,
                  (window[kCGWindowOwnerPID as String] as? pid_t) != ownPid,
                  let dict = window[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: dict as CFDictionary) else { continue }
            for (id, frame) in screens where abs(bounds.minX - frame.minX) < 1 && abs(bounds.minY - frame.minY) < 1
                && abs(bounds.width - frame.width) < 1 && abs(bounds.height - frame.height) < 1 {
                covered.insert(id)
            }
        }
        return covered
    }

    public static func fullScreenNow(screens: [String: CGRect]) -> Set<String> {
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return fullScreen(windows: list, screens: screens, ownPid: getpid())
    }

    /// Whether any app records from the default input: a call, most of the time (also dictation and voice memos).
    public static func microphoneInUse() -> Bool {
        guard let device = defaultInput() else { return false }
        var running: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &running) == noErr else { return false }
        return running != 0
    }

    /// Calls `changed` on the main queue when the microphone starts or stops, or the default input changes.
    /// Returns the stop.
    public static func watchMicrophone(_ changed: @escaping @Sendable () -> Void) -> () -> Void {
        var defaultAddress = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                                        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var runningAddress = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
                                                        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        let lock = NSLock()
        nonisolated(unsafe) var device = defaultInput()
        let onRunning: AudioObjectPropertyListenerBlock = { _, _ in changed() }
        let onDefault: AudioObjectPropertyListenerBlock = { _, _ in
            lock.lock()
            if let old = device { AudioObjectRemovePropertyListenerBlock(old, &runningAddress, .main, onRunning) }
            device = defaultInput()
            if let new = device { AudioObjectAddPropertyListenerBlock(new, &runningAddress, .main, onRunning) }
            lock.unlock()
            changed()
        }
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &defaultAddress, .main, onDefault)
        if let device { AudioObjectAddPropertyListenerBlock(device, &runningAddress, .main, onRunning) }
        return {
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &defaultAddress, .main, onDefault)
            lock.lock()
            if let device { AudioObjectRemovePropertyListenerBlock(device, &runningAddress, .main, onRunning) }
            lock.unlock()
        }
    }

    private static func defaultInput() -> AudioObjectID? {
        var device = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr,
              device != 0 else { return nil }
        return device
    }
}
