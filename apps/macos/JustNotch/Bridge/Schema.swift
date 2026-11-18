import CoreGraphics
import Foundation

// Hand mirror of packages/bridge-schema/src/index.ts: change both in the same commit.

struct Rect: Codable, Equatable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double

    func contains(_ p: CGPoint) -> Bool {
        p.x >= x && p.x < x + w && p.y >= y && p.y < y + h
    }

    func insetBy(dx: Double, dy: Double) -> Rect {
        Rect(x: x + dx, y: y + dy, w: w - 2 * dx, h: h - 2 * dy)
    }
}

enum Permission: String, Codable {
    case mediaRead = "media.read"
    case mediaControl = "media.control"
    case powerRead = "power.read"
    case audioRead = "audio.read"
    case audioControl = "audio.control"
    case displayControl = "display.control"
    case hud
    case calendarRead = "calendar.read"
    case files
    case bluetoothRead = "bluetooth.read"
    case statsRead = "stats.read"
    case weatherRead = "weather.read"
    case clipboard
    case filesRecent = "files.recent"
    case net
    case secrets
}

struct PluginManifest: Codable, Equatable {
    struct Engines: Codable, Equatable {
        var notch: String
    }

    var id: String
    var name: String
    var version: String
    var description: String?
    var entry: String
    var style: String?
    var permissions: [Permission]
    var hosts: [String]?
    var engines: Engines
}

struct InstalledPlugin: Codable, Equatable {
    var manifest: PluginManifest
    var baseUrl: String
    var enabled: Bool
    var builtIn: Bool
}

struct ScreenGeometry: Codable, Equatable {
    struct Size: Codable, Equatable {
        var w: Double
        var h: Double
    }

    var panel: Size
    var notch: Rect
    var hasNotch: Bool
    var scale: Double
    var screenId: String
}

struct HostInfo: Codable {
    var version: String
    var devMode: Bool
    var devServerUrl: String?
    var plugins: [InstalledPlugin]
    var geometry: ScreenGeometry
}

struct AppPreferences: Codable, Equatable {
    enum Screens: String, Codable {
        case notched, all
    }

    var launchAtLogin: Bool
    var screens: Screens
}

enum Schema {
    static let topicPermission: [String: Permission] = [
        "media": .mediaRead,
        "power": .powerRead,
        "audio": .audioRead,
        "calendar": .calendarRead,
        "bluetooth": .bluetoothRead,
        "stats": .statsRead,
        "processes": .statsRead,
        "display": .displayControl,
        "weather": .weatherRead,
        "clipboard": .clipboard,
        "recentFiles": .filesRecent,
    ]

    static let methodPermission: [String: Permission] = [
        "media.command": .mediaControl,
        "audio.setVolume": .audioControl,
        "display.setBrightness": .displayControl,
        "display.setKeyboardBacklight": .displayControl,
        "hud.setEnabled": .hud,
        "calendar.requestAccess": .calendarRead,
        "weather.requestAccess": .weatherRead,
        "weather.setLocation": .weatherRead,
        "weather.refresh": .weatherRead,
        "clipboard.copy": .clipboard,
        "clipboard.delete": .clipboard,
        "clipboard.pin": .clipboard,
        "clipboard.clear": .clipboard,
        "clipboard.setPaused": .clipboard,
        "clipboard.setIgnoredApps": .clipboard,
        "apps.list": .clipboard,
        "recentFiles.clear": .filesRecent,
        "recentFiles.chooseFolder": .filesRecent,
        "recentFiles.resetFolder": .filesRecent,
        "recentFiles.cancelDownload": .filesRecent,
        "files.thumbnail": .files,
        "files.airdrop": .files,
        "files.reveal": .files,
        "files.open": .files,
        "files.beginDrag": .files,
        "files.copy": .files,
        "files.trash": .files,
        "clipboard.readText": .clipboard,
        "net.fetch": .net,
        "net.requestHost": .net,
        "net.hosts": .net,
        "net.revokeHost": .net,
        "secrets.get": .secrets,
        "secrets.set": .secrets,
        "secrets.delete": .secrets,
    ]

    static let runtimeOnly: Set<String> = [
        "host.ready",
        "window.setHitRegions",
        "window.setFocusable",
        "window.endGesture",
        "plugins.setEnabled",
        "app.preferences",
        "app.setPreferences",
        "shortcuts.register",
        "shortcuts.unregister",
        "deepLinks.initial",
        "updater.check",
        "updater.install",
        "net.revokeHost",
    ]

    /// Methods that act for one plugin (its hosts, its Keychain entries): never as `runtime`.
    static let pluginOnly: Set<String> = [
        "net.fetch",
        "net.requestHost",
        "net.hosts",
        "secrets.get",
        "secrets.set",
        "secrets.delete",
    ]
}

// Params of the methods the host answers itself.

struct LogParams: Decodable {
    var level: String
    var message: String
}

struct HitRegionsParams: Decodable {
    var rects: [Rect]
}

struct FocusableParams: Decodable {
    var focusable: Bool
}

struct TopicParams: Decodable {
    var topic: String
}

struct PathsParams: Decodable {
    var paths: [String]
}

struct KeyParams: Decodable {
    var key: String
}

struct UrlParams: Decodable {
    var url: String
}

struct PermissionParams: Decodable {
    var permission: String
}

struct SetEnabledParams: Decodable {
    var id: String
    var enabled: Bool
}

/// `Partial<AppPreferences>`.
struct PreferencesParams: Decodable {
    var launchAtLogin: Bool?
    var screens: AppPreferences.Screens?
}

struct AcceleratorParams: Decodable {
    var accelerator: String
}

struct IdParams: Decodable {
    var id: String
}

struct IdResult: Encodable {
    var id: String
}

/// `{ url: string | null }`: the key is always there.
struct DeepLinkResult: Encodable {
    var url: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(["url": url])
    }
}

/// `UpdateState`: the kind plus the fields it carries (nil ones are left out).
struct UpdateState: Encodable {
    var kind: String
    var version: String?
    var notes: String?
    var progress: Double?
    var message: String?

    static let idle = UpdateState(kind: "idle")
    static func available(_ version: String, notes: String?) -> Self { .init(kind: "available", version: version, notes: notes) }
    static func downloading(_ progress: Double) -> Self { .init(kind: "downloading", progress: progress) }
    static func ready(_ version: String) -> Self { .init(kind: "ready", version: version) }
    static func error(_ message: String) -> Self { .init(kind: "error", message: message) }
}

struct GrantedResult: Encodable {
    var granted: Bool
}

struct HoverPayload: Encodable {
    var inside: Bool
}

struct DraggingPayload: Encodable {
    var active: Bool
    var count: Int
}

struct PluginsChangedPayload: Encodable {
    var plugins: [InstalledPlugin]
}

// `net.fetch` params and result are `NetRequest` / `NetResponse` in NotchServices (Plugins/HTTPProxy.swift).

struct RequestHostParams: Decodable {
    var url: String
    var reason: String?
}

struct HostsResult: Encodable {
    var manifest: [String]
    var granted: [String]
}

struct RevokeHostParams: Decodable {
    var plugin: String
    var host: String
}

struct SecretSetParams: Decodable {
    var key: String
    var value: String
}

/// `{ value: string | null }`: the key is always there.
struct SecretResult: Encodable {
    var value: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(["value": value])
    }
}

struct SecretsChangedPayload: Encodable {
    var plugin: String
    var key: String
}

struct HapticParams: Decodable {
    enum Pattern: String, Decodable { case generic, alignment, levelChange }
    let pattern: Pattern
}
