import Foundation

// Codable mirrors of packages/bridge-schema. Keys match the TS shapes exactly;
// optional fields are omitted when nil, timestamps are ms since the Unix epoch.

public struct MediaState: Codable, Equatable, Sendable {
    public enum Repeat: String, Codable, Sendable { case off, all, one }
    public var playing: Bool
    public var title: String
    public var artist: String
    public var album: String
    public var artworkUrl: String?
    public var durationS: Double
    public var positionS: Double
    public var rate: Double
    public var updatedAt: Double
    public var sourceApp: String?
    public var shuffle: Bool?
    public var `repeat`: Repeat?
    /// The modes `repeat` steps through; nil: all three.
    public var repeatModes: [Repeat]?
    public var liked: Bool?
}

public struct PowerState: Codable, Equatable, Sendable {
    public var percent: Double
    public var charging: Bool
    public var pluggedIn: Bool
    public var minutesRemaining: Double?
    public var lowPowerMode: Bool
    public var hasBattery: Bool
}

public struct AudioState: Codable, Equatable, Sendable {
    public var volume: Double
    public var muted: Bool
    public var outputDevice: String
}

public struct CalendarEvent: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var start: Double
    public var end: Double
    public var allDay: Bool
    public var calendarColor: String
    public var location: String?
    public var meetingUrl: String?
}

public struct CalendarState: Codable, Equatable, Sendable {
    public enum Access: String, Codable, Sendable { case granted, denied, undetermined }
    public var access: Access
    public var upcoming: [CalendarEvent]
}

public struct BluetoothDevice: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case headphones, keyboard, mouse, speaker, other }
    public var id: String
    public var name: String
    public var kind: Kind
    public var connected: Bool
    public var batteryPercent: Double?
}

public struct StatsState: Codable, Equatable, Sendable {
    public enum Pressure: String, Codable, Sendable { case normal, warning, critical }
    public var cpu: Double
    public var memoryUsed: Double
    public var memoryTotal: Double
    public var memoryPressure: Pressure
    public var netInBps: Double
    public var netOutBps: Double
    public var diskFree: Double
    public var diskTotal: Double
    public var uptimeS: Double
}

public struct ProcessSample: Codable, Equatable, Sendable {
    public var pid: Int32
    public var name: String
    public var cpu: Double
    public var memory: Double
}

public struct WeatherNow: Codable, Equatable, Sendable {
    public var time: Double
    public var temperature: Double
    public var apparent: Double
    public var code: Int
    public var isDay: Bool
    public var wind: Double
    public var humidity: Double
    public var uv: Double
}

public struct WeatherHour: Codable, Equatable, Sendable {
    public var time: Double
    public var temperature: Double
    public var code: Int
    public var isDay: Bool
    public var precipitation: Double
}

public struct WeatherDay: Codable, Equatable, Sendable {
    public var date: Double
    public var code: Int
    public var high: Double
    public var low: Double
    public var precipitation: Double
    public var sunrise: Double?
    public var sunset: Double?
}

/// `{ mode: 'auto' } | { mode: 'city'; city: string }`.
public struct WeatherLocation: Codable, Equatable, Sendable {
    public enum Mode: String, Codable, Sendable { case auto, city }
    public var mode: Mode
    public var city: String?

    public static let auto = WeatherLocation(mode: .auto)
}

public struct WeatherState: Codable, Equatable, Sendable {
    public enum Access: String, Codable, Sendable { case granted, denied, undetermined }
    public enum Status: String, Codable, Sendable { case ready, loading, error, offline }
    public var access: Access
    public var status: Status
    public var setting: WeatherLocation
    public var location: String?
    public var current: WeatherNow?
    public var hours: [WeatherHour]
    public var days: [WeatherDay]
    public var updatedAt: Double?
}

public struct Clip: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case text, link, image, color, file }
    public var id: String
    public var kind: Kind
    public var content: String
    public var detail: String?
    public var preview: String?
    public var app: String?
    public var copiedAt: Double
    public var pinned: Bool
}

public struct ClipboardState: Codable, Equatable, Sendable {
    public var clips: [Clip]
    public var paused: Bool
    public var ignoredApps: [String]
    public var retention: ClipboardRetention

    public init(clips: [Clip], paused: Bool, ignoredApps: [String], retention: ClipboardRetention = .standard) {
        self.clips = clips
        self.paused = paused
        self.ignoredApps = ignoredApps
        self.retention = retention
    }

    // History saved before retention existed has none: it gets the default.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        clips = try c.decode([Clip].self, forKey: .clips)
        paused = try c.decode(Bool.self, forKey: .paused)
        ignoredApps = try c.decode([String].self, forKey: .ignoredApps)
        retention = try c.decodeIfPresent(ClipboardRetention.self, forKey: .retention) ?? .standard
    }
}

/// `clipboard.setRetention`: at most `limit` unpinned clips, none older than `days` (nil: no age limit).
public struct ClipboardRetention: Codable, Equatable, Sendable {
    public var limit: Int
    public var days: Int?
    public static let standard = ClipboardRetention(limit: 1000, days: 30)
}

public struct AppInfo: Codable, Equatable, Sendable {
    public var bundleId: String
    public var name: String
    public var icon: String?
    /// The bundle's path; `apps.index` fills it, `apps.list` leaves it out.
    public var path: String?
    /// Other names it answers to in a search: its English name under a localized one, its executable's.
    public var keywords: [String]?
}

public struct FileHit: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case folder, application, image, pdf, document, other }
    public var path: String
    public var name: String
    public var kind: Kind
    /// ISO 8601.
    public var modified: String?
    /// ISO 8601.
    public var lastUsed: String?
    /// Bytes; folders leave it out.
    public var size: Int?
}

public struct CurrencyRates: Codable, Equatable, Sendable {
    public var base: String
    /// `YYYY-MM-DD`.
    public var date: String
    public var rates: [String: Double]
}

public enum SystemAction: String, Codable, Sendable {
    case sleep, displaySleep, screenSaver, emptyTrash, toggleDarkMode
}

public struct RecentFile: Codable, Equatable, Sendable {
    public enum Source: String, Codable, Sendable { case downloads, screenshots }
    public var id: String
    public var name: String
    public var size: Double
    public var addedAt: Double
    public var source: Source
    public var from: String?
}

public struct ActiveDownload: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var received: Double
    public var total: Double?
    public var rate: Double
    public var from: String?
}

public struct RecentFolder: Codable, Equatable, Sendable {
    public var path: String
    public var custom: Bool
}

public struct RecentFilesState: Codable, Equatable, Sendable {
    public enum Access: String, Codable, Sendable { case granted, denied }
    /// `Record<RecentFile['source'], RecentFolder>`.
    public struct Folders: Codable, Equatable, Sendable {
        public var downloads: RecentFolder
        public var screenshots: RecentFolder
    }
    public var access: Access
    public var files: [RecentFile]
    public var downloads: [ActiveDownload]
    public var folders: Folders
}

public struct DisplayState: Codable, Equatable, Sendable {
    public var brightness: Double
    public var keyboardBacklight: Double?
}

// Events

public struct HUDEvent: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case volume, brightness, keyboard }
    public var kind: Kind
    public var value: Double
    public var muted: Bool?
}

public struct PluggedEvent: Codable, Equatable, Sendable {
    public var pluggedIn: Bool
}

// Method params and results

public enum MediaCommand: Equatable, Sendable, Decodable {
    case play, pause, toggle, next, previous
    case seek(positionS: Double)
    case shuffle(Bool)
    case `repeat`(MediaState.Repeat)
    case like(Bool)

    private enum CodingKeys: String, CodingKey { case command, positionS, shuffle, `repeat`, liked }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let command = try container.decode(String.self, forKey: .command)
        switch command {
        case "play": self = .play
        case "pause": self = .pause
        case "toggle": self = .toggle
        case "next": self = .next
        case "previous": self = .previous
        case "seek": self = .seek(positionS: try container.decode(Double.self, forKey: .positionS))
        case "shuffle": self = .shuffle(try container.decode(Bool.self, forKey: .shuffle))
        case "repeat": self = .repeat(try container.decode(MediaState.Repeat.self, forKey: .repeat))
        case "like": self = .like(try container.decode(Bool.self, forKey: .liked))
        default: throw ServiceError("unknown media command \(command)")
        }
    }
}

struct VolumeParams: Decodable { var volume: Double }
struct BrightnessParams: Decodable { var brightness: Double }
struct LevelParams: Decodable { var level: Double }
struct EnabledParams: Decodable { var enabled: Bool }
struct EnabledResult: Encodable { var enabled: Bool }
struct GrantedResult: Encodable { var granted: Bool }
struct ThumbnailParams: Decodable { var path: String; var size: Double }
struct URLResult: Encodable { var url: String }
struct PathsParams: Decodable { var paths: [String] }
struct PathParams: Decodable { var path: String }
struct OpenParams: Decodable { var path: String; var app: String? }
struct TextParams: Decodable { var text: String }
struct TextResult: Encodable { var text: String }
struct NotificationParams: Decodable { var title: String; var body: String? }
struct IdParams: Decodable { var id: String }
struct PinParams: Decodable { var id: String; var pinned: Bool }
struct PausedParams: Decodable { var paused: Bool }
struct AppsParams: Decodable { var apps: [String] }
struct SourceParams: Decodable { var source: RecentFile.Source }
struct FileSearchParams: Decodable { var query: String; var limit: Int? }
struct PasteParams: Decodable { var id: String; var plain: Bool? }
struct PastedResult: Encodable { var pasted: Bool }
struct NameParams: Decodable { var name: String }
struct SystemActionParams: Decodable { var action: SystemAction }

func decode<T: Decodable>(_ type: T.Type, _ params: Data) throws -> T {
    do { return try JSONDecoder().decode(type, from: params) } catch { throw ServiceError("invalid params: \(error)") }
}

/// Remembers the last value handed out so a service publishes only on change.
struct Latest<Value: Equatable> {
    private(set) var value: Value?

    /// Stores `new` and says whether it differs from the previous value.
    mutating func update(_ new: Value) -> Bool {
        guard new != value else { return false }
        value = new
        return true
    }

    mutating func reset() { value = nil }
}

let jsonNull = Data("null".utf8)

func nowMs() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }
