import Foundation
import Network
import SystemConfiguration

/// `network` topic: online or not, over what, whether a VPN carries the traffic, and, only while an app records from
/// the microphone (a call), how long a connection to the internet takes. The probe is a TCP handshake with 1.1.1.1
/// every 5 s that sends no data; it stops when the call ends.
@MainActor
public final class NetworkService: NotchService {
    public let topics = ["network"]
    public weak var sink: ServiceSink?

    private var monitor: NWPathMonitor?
    private var path: NWPath?
    private var stopMicrophone: (() -> Void)?
    private var probeTimer: Timer?
    private var latency: Double?
    private var failures = 0
    private var latest = Latest<NetworkState>()

    private static let probeEvery: TimeInterval = 5
    private static let probeTimeout: TimeInterval = 3

    public init() {}

    public func start(topic: String) {
        guard monitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.path = path
                self?.refresh()
            }
        }
        monitor.start(queue: .main)
        self.monitor = monitor
        stopMicrophone = Presence.watchMicrophone { Task { @MainActor [weak self] in self?.followCall() } }
        followCall()
    }

    public func stop(topic: String) {
        monitor?.cancel()
        monitor = nil
        stopMicrophone?()
        stopMicrophone = nil
        probeTimer?.invalidate()
        probeTimer = nil
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        state().json()
    }

    /// Probes while a call is on; forgets the figures when it ends.
    private func followCall() {
        let inCall = Presence.microphoneInUse()
        if inCall, probeTimer == nil {
            probeTimer = Timer.scheduledTimer(withTimeInterval: Self.probeEvery, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.probe() }
            }
            probe()
        } else if !inCall, probeTimer != nil {
            probeTimer?.invalidate()
            probeTimer = nil
            latency = nil
            failures = 0
        }
        refresh()
    }

    private func probe() {
        let started = Date()
        let connection = NWConnection(host: "1.1.1.1", port: 443, using: .tcp)
        let once = Once()
        let finish: @Sendable (Bool) -> Void = { [weak self] ok in
            once.run {
                connection.cancel()
                let elapsed = Date().timeIntervalSince(started) * 1000
                Task { @MainActor in self?.probed(ok ? elapsed : nil) }
            }
        }
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready: finish(true)
            case .failed, .waiting: finish(false)
            default: break
            }
        }
        connection.start(queue: .global(qos: .utility))
        DispatchQueue.global().asyncAfter(deadline: .now() + Self.probeTimeout) { finish(false) }
    }

    private func probed(_ milliseconds: Double?) {
        guard probeTimer != nil else { return }
        if let milliseconds {
            latency = milliseconds.rounded()
            failures = 0
        } else {
            failures += 1
        }
        refresh()
    }

    private func refresh() {
        guard monitor != nil else { return }
        let state = state()
        guard latest.update(state), let data = state.json() else { return }
        sink?.publish(topic: "network", value: data)
    }

    private func state() -> NetworkState {
        let path = path ?? monitor?.currentPath
        let online = path?.status == .satisfied
        let kind: NetworkState.Kind? = if !online { nil }
            else if path?.usesInterfaceType(.wifi) == true { .wifi }
            else if path?.usesInterfaceType(.wiredEthernet) == true { .ethernet }
            else if path?.usesInterfaceType(.cellular) == true { .cellular }
            else { .other }
        return NetworkState(
            online: online,
            kind: kind,
            vpn: online && Self.vpnIsPrimary(),
            inCall: probeTimer != nil,
            latencyMs: probeTimer != nil ? latency : nil,
            failedProbes: probeTimer != nil ? failures : 0
        )
    }

    /// A full-tunnel VPN becomes the primary interface (`utun…`, `ppp…`, `ipsec…`); split tunnels don't count.
    static func vpnIsPrimary() -> Bool {
        guard let store = SCDynamicStoreCreate(nil, "just-notch" as CFString, nil, nil),
              let global = SCDynamicStoreCopyValue(store, "State:/Network/Global/IPv4" as CFString) as? [String: Any],
              let primary = global["PrimaryInterface"] as? String else { return false }
        return ["utun", "ppp", "ipsec", "tun", "tap", "wg"].contains { primary.hasPrefix($0) }
    }
}

/// bridge-schema `NetworkState`.
public struct NetworkState: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case wifi, ethernet, cellular, other
    }

    public var online: Bool
    public var kind: Kind?
    public var vpn: Bool
    public var inCall: Bool
    public var latencyMs: Double?
    public var failedProbes: Int
}
