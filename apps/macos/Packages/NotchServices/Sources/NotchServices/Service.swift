import Foundation

/// A system service the host exposes over the bridge (packages/bridge-schema).
///
/// Services are idle until the host calls `start(topic:)` for their first
/// subscriber and go idle again on `stop(topic:)` after the last one leaves, so
/// nothing is observed or polled that no plugin is showing.
@MainActor
public protocol NotchService: AnyObject {
    /// `Topics` keys this service publishes.
    var topics: [String] { get }
    /// `Methods` keys this service answers.
    var methods: [String] { get }
    /// Set by the host before any other call.
    var sink: ServiceSink? { get set }

    func start(topic: String)
    func stop(topic: String)
    /// The topic's current value as JSON (the bridge-schema shape), or nil while unknown.
    func snapshot(topic: String) async -> Data?
    /// Answers a method; returns the result as JSON, or nil for `null`.
    func handle(method: String, params: Data) async throws -> Data?
}

public extension NotchService {
    var topics: [String] { [] }
    var methods: [String] { [] }
    func start(topic: String) {}
    func stop(topic: String) {}
    func snapshot(topic: String) async -> Data? { nil }
    func handle(method: String, params: Data) async throws -> Data? { throw ServiceError("unknown method \(method)") }
}

/// The host side a service pushes into.
@MainActor
public protocol ServiceSink: AnyObject {
    /// A new value for a subscribed topic (JSON, bridge-schema `Topics[topic]`).
    func publish(topic: String, value: Data)
    /// A bridge-schema `Events` entry, e.g. `hud` or `bluetooth.connected`.
    func emit(event: String, payload: Data)
}

public struct ServiceError: Error, LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public extension Encodable {
    func json() -> Data? { try? JSONEncoder().encode(self) }
}
