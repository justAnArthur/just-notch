import AppKit

/// The native dialogs that grant a plugin something. Never the web view's: a page can draw anything.
@MainActor
enum Consent {
    /// Plain wording of each permission, as the install dialog lists it (the Library page's `permissionInfo` matches).
    static func describe(_ permission: String, hosts: [String]) -> String {
        switch permission {
        case "media.read": "See what’s playing in your music and video apps"
        case "media.control": "Play, pause and skip in your media apps"
        case "power.read": "See your battery level and charging state"
        case "power.control": "Keep your Mac awake"
        case "screen.read": "Read the text in parts of the screen you pick"
        case "reminders": "See, add and complete your reminders"
        case "network.read": "See whether you are online, and how quick the connection is during calls"
        case "audio.read": "See the volume and the output device"
        case "audio.control": "Change the volume"
        case "display.control": "See and change screen and keyboard brightness"
        case "hud": "Replace the volume and brightness overlay"
        case "calendar.read": "Read your calendar events"
        case "files": "Open, preview, share and trash files you give it"
        case "bluetooth.read": "See your Bluetooth devices and their battery"
        case "stats.read": "See CPU, memory, network and disk use, and the busiest apps"
        case "weather.read": "Get the weather where you are"
        case "clipboard": "Read what you copy and your clipboard history"
        case "files.recent": "See your recent downloads and screenshots"
        case "apps.read": "See your installed apps"
        case "apps.launch": "Open your apps"
        case "files.search": "Find your files and folders by name"
        case "net": hosts.isEmpty ? "Connect to the internet, to sites you allow" : "Connect to the internet: \(hosts.joined(separator: ", "))"
        case "secrets": "Keep passwords and tokens in your Keychain"
        case "windows": "Move and resize your windows"
        case "hotkeys": "Use global keyboard shortcuts"
        default: "Use “\(permission)”"
        }
    }

    /// A fresh install lists everything it asks for; an update only what it adds.
    static func install(name: String, version: String, author: String?, permissions: [String], hosts: [String], update: Bool) -> Bool {
        #if DEBUG
        if let auto = DebugConsent.answer { return auto.accept }
        #endif
        var lines = permissions.map { "• " + describe($0, hosts: hosts) }
        // Hosts without `net` can't be reached; listed anyway, so nothing it declares goes unsaid.
        if !permissions.contains("net"), !hosts.isEmpty { lines.append("• Talk to \(hosts.joined(separator: ", "))") }

        let alert = NSAlert()
        var text: [String] = []
        if update {
            alert.messageText = "Update “\(name)” to \(version)?"
            text.append(lines.isEmpty ? "This version asks for nothing new." : "This version can also:\n" + lines.joined(separator: "\n"))
        } else {
            alert.messageText = "Install “\(name)” \(version)?"
            let firstParty = author.map(isFirstParty) ?? false
            if firstParty { text.append("By Just Notch.") } else if let author { text.append("By \(author).") }
            text.append(lines.isEmpty ? "It asks for no permissions." : "It will be able to:\n" + lines.joined(separator: "\n"))
            // The shared-context caution matters for someone else's code, not for the app's own plugins.
            if !firstParty {
                text.append("Plugins run inside Just Notch alongside your other plugins, so a plugin can reach what the others can. Install only plugins you trust.")
            }
        }
        alert.informativeText = text.joined(separator: "\n\n")
        alert.addButton(withTitle: update ? "Update" : "Install")
        alert.addButton(withTitle: "Cancel")
        return run(alert)
    }

    /// The app's own plugins, as the library's catalog names their author.
    static func isFirstParty(_ author: String) -> Bool {
        author.caseInsensitiveCompare("justAnArthur") == .orderedSame
    }

    /// Whether to uninstall, and whether to drop the plugin's data too (unchecked by default).
    static func uninstall(name: String) -> (confirmed: Bool, deleteData: Bool) {
        #if DEBUG
        if let auto = DebugConsent.answer { return (auto.accept, auto.deleteData) }
        #endif
        let alert = NSAlert()
        alert.messageText = "Uninstall “\(name)”?"
        alert.informativeText = "It moves to the Trash."
        alert.showsSuppressionButton = true
        alert.suppressionButton?.title = "Also delete its saved data and keychain items"
        alert.suppressionButton?.state = .off
        alert.addButton(withTitle: "Uninstall")
        alert.addButton(withTitle: "Cancel")
        let confirmed = run(alert)
        return (confirmed, confirmed && alert.suppressionButton?.state == .on)
    }

    static func host(name: String, host: String, reason: String?) -> Bool {
        let alert = NSAlert()
        alert.messageText = "“\(name)” wants to connect to \(host). It can send anything it stores there, including saved tokens."
        alert.informativeText = reason ?? ""
        alert.addButton(withTitle: "Allow")
        alert.addButton(withTitle: "Don’t Allow")
        return run(alert)
    }

    /// Above the island's panel (`NotchPanel`, mainMenu + 3), which otherwise covers the dialog and its buttons.
    private static func run(_ alert: NSAlert) -> Bool {
        NSApp.activate()
        alert.layout()
        alert.window.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 4)
        return alert.runModal() == .alertFirstButtonReturn
    }
}

#if DEBUG
/// DEBUG BUILDS ONLY, for automated tests: `NOTCH_CONSENT_AUTO=accept` (or `accept-delete`, `deny`) answers the
/// library's install and uninstall dialogs without showing them. Compiled out of Release.
enum DebugConsent {
    static var answer: (accept: Bool, deleteData: Bool)? {
        switch ProcessInfo.processInfo.environment["NOTCH_CONSENT_AUTO"] {
        case "accept": (true, false)
        case "accept-delete": (true, true)
        case "deny": (false, false)
        default: nil
        }
    }
}
#endif
