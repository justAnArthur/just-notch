import AppKit
import Carbon.HIToolbox
import NotchServices

/// System-wide shortcuts through Carbon's `RegisterEventHotKey`, which needs no Accessibility permission.
/// Each belongs to the web view that registered it and goes when that page does.
@MainActor
final class HotKeys {
    private struct Entry {
        let ref: EventHotKeyRef
        let owner: ObjectIdentifier
    }

    /// Carbon calls back with a numeric id; the bridge speaks strings.
    private var entries: [UInt32: Entry] = [:]
    private var nextId: UInt32 = 1
    private var handler: EventHandlerRef?
    var onPress: ((_ id: String, _ owner: ObjectIdentifier) -> Void)?

    private static let signature: OSType = 0x4A_4E_54_48 // "JNTH"
    nonisolated(unsafe) private static weak var shared: HotKeys?

    init() {
        Self.shared = self
    }

    func register(_ accelerator: String, owner: ObjectIdentifier) throws -> String {
        let (keyCode, modifiers) = try Self.parse(accelerator)
        installHandler()
        let id = nextId
        nextId += 1
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(keyCode, modifiers, EventHotKeyID(signature: Self.signature, id: id), GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { throw ServiceError("\(accelerator) is taken by another app or the system") }
        entries[id] = Entry(ref: ref, owner: owner)
        return String(id)
    }

    func unregister(_ id: String, owner: ObjectIdentifier) {
        guard let key = UInt32(id), let entry = entries[key], entry.owner == owner else { return }
        UnregisterEventHotKey(entry.ref)
        entries[key] = nil
    }

    /// Everything a page registered, when it reloads or goes away.
    func release(owner: ObjectIdentifier) {
        for (key, entry) in entries where entry.owner == owner {
            UnregisterEventHotKey(entry.ref)
            entries[key] = nil
        }
    }

    private func installHandler() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var hotKey = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &hotKey)
            let id = hotKey.id
            // Carbon delivers application events on the main thread.
            MainActor.assumeIsolated { HotKeys.shared?.pressed(id) }
            return noErr
        }, 1, &spec, nil, &handler)
    }

    private func pressed(_ id: UInt32) {
        guard let entry = entries[id] else { return }
        onPress?(String(id), entry.owner)
    }

    // MARK: accelerators

    /// `CommandOrControl+Shift+Space`, as Electron and Tauri write them; Control means ⌃, CommandOrControl ⌘.
    static func parse(_ accelerator: String) throws -> (UInt32, UInt32) {
        let parts = accelerator.split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let key = parts.last, !key.isEmpty else { throw ServiceError("empty shortcut") }
        var modifiers: UInt32 = 0
        for part in parts.dropLast() {
            switch part.lowercased() {
            case "commandorcontrol", "cmdorctrl", "command", "cmd", "super", "meta": modifiers |= UInt32(cmdKey)
            case "control", "ctrl": modifiers |= UInt32(controlKey)
            case "alt", "option": modifiers |= UInt32(optionKey)
            case "shift": modifiers |= UInt32(shiftKey)
            default: throw ServiceError("unknown modifier \(part) in \(accelerator)")
            }
        }
        let name = key.lowercased()
        guard let code = keyCodes[name] else { throw ServiceError("unknown key \(key) in \(accelerator)") }
        let functionKey = name.count > 1 && name.hasPrefix("f") && Int(name.dropFirst()) != nil
        guard modifiers != 0 || functionKey else { throw ServiceError("\(accelerator) needs a modifier") }
        return (UInt32(code), modifiers)
    }

    private static let keyCodes: [String: Int] = {
        var codes: [String: Int] = [
            "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F,
            "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
            "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R,
            "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
            "y": kVK_ANSI_Y, "z": kVK_ANSI_Z,
            "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
            "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
            "space": kVK_Space, "enter": kVK_Return, "return": kVK_Return, "tab": kVK_Tab, "escape": kVK_Escape, "esc": kVK_Escape,
            "backspace": kVK_Delete, "delete": kVK_ForwardDelete, "up": kVK_UpArrow, "down": kVK_DownArrow,
            "left": kVK_LeftArrow, "right": kVK_RightArrow, "home": kVK_Home, "end": kVK_End,
            "pageup": kVK_PageUp, "pagedown": kVK_PageDown,
            "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, "[": kVK_ANSI_LeftBracket, "]": kVK_ANSI_RightBracket,
            ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period,
            "/": kVK_ANSI_Slash, "\\": kVK_ANSI_Backslash, "`": kVK_ANSI_Grave,
        ]
        let functionKeys = [kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8, kVK_F9, kVK_F10,
                            kVK_F11, kVK_F12, kVK_F13, kVK_F14, kVK_F15, kVK_F16, kVK_F17, kVK_F18, kVK_F19, kVK_F20]
        for (index, code) in functionKeys.enumerated() { codes["f\(index + 1)"] = code }
        return codes
    }()
}
