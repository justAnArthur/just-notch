import Foundation

// Codable mirrors of packages/bridge-schema. Keys match the TS shapes exactly;
// optional fields are omitted when nil, timestamps are ms since the Unix epoch.

public struct MediaState: Codable, Equatable, Sendable {
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
    public var cpu: Double
    public var memoryUsed: Double
    public var memoryTotal: Double
    public var netInBps: Double
    public var netOutBps: Double
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

    private enum CodingKeys: String, CodingKey { case command, positionS }

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
        default: throw ServiceError("unknown media command \(command)")
        }
    }
}

struct VolumeParams: Decodable { var volume: Double }
struct BrightnessParams: Decodable { var brightness: Double }
struct EnabledParams: Decodable { var enabled: Bool }
struct EnabledResult: Encodable { var enabled: Bool }
struct GrantedResult: Encodable { var granted: Bool }
struct ThumbnailParams: Decodable { var path: String; var size: Double }
struct URLResult: Encodable { var url: String }
struct PathsParams: Decodable { var paths: [String] }
struct PathParams: Decodable { var path: String }

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
