import Foundation
import IOKit.pwr_mgt

/// `power.stayAwake` / `power.allowSleep`: an IOPM assertion that keeps the Mac (and optionally the display) from
/// idle sleep. One hold for the app; a new call replaces it. The assertion dies with the process.
@MainActor
public final class AwakeService: NotchService {
    public let topics: [String] = []
    public let methods = ["power.stayAwake", "power.allowSleep"]
    public weak var sink: ServiceSink?

    private var assertion: IOPMAssertionID?

    public init() {}

    public func start(topic: String) {}
    public func stop(topic: String) {}
    public func snapshot(topic: String) async -> Data? { nil }

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "power.stayAwake":
            struct Params: Decodable {
                var display: Bool
                var reason: String
            }
            let params = try decode(Params.self, params)
            release()
            let type = (params.display ? kIOPMAssertionTypePreventUserIdleDisplaySleep : kIOPMAssertionTypePreventUserIdleSystemSleep) as CFString
            var id: IOPMAssertionID = 0
            let reason = String(params.reason.prefix(120)) as CFString
            guard IOPMAssertionCreateWithName(type, IOPMAssertionLevel(kIOPMAssertionLevelOn), reason, &id) == kIOReturnSuccess else {
                throw ServiceError("couldn't keep the Mac awake")
            }
            assertion = id
        case "power.allowSleep":
            release()
        default:
            throw ServiceError("unknown method \(method)")
        }
        return nil
    }

    var isHolding: Bool { assertion != nil }

    private func release() {
        guard let assertion else { return }
        IOPMAssertionRelease(assertion)
        self.assertion = nil
    }
}
