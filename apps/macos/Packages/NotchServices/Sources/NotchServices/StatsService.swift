import Darwin
import Foundation

struct CPUTicks: Equatable {
    var user: UInt32
    var system: UInt32
    var idle: UInt32
    var nice: UInt32

    static func read() -> CPUTicks? {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count) }
        }
        guard status == KERN_SUCCESS else { return nil }
        let ticks = info.cpu_ticks
        return CPUTicks(user: ticks.0, system: ticks.1, idle: ticks.2, nice: ticks.3)
    }

    /// Busy share of the ticks between two samples, 0…1. Counters wrap at 2³².
    static func usage(from old: CPUTicks, to new: CPUTicks) -> Double {
        let busy = Double(new.user &- old.user) + Double(new.system &- old.system) + Double(new.nice &- old.nice)
        let total = busy + Double(new.idle &- old.idle)
        return total > 0 ? busy / total : 0
    }
}

struct NetCounters: Equatable {
    var bytesIn: UInt32
    var bytesOut: UInt32

    /// Per interface, skipping loopback and interfaces that are down.
    static func read() -> [String: NetCounters] {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return [:] }
        defer { freeifaddrs(list) }

        var counters: [String: NetCounters] = [:]
        for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = entry.pointee
            let flags = Int32(ifa.ifa_flags)
            guard ifa.ifa_addr?.pointee.sa_family == UInt8(AF_LINK), flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0,
                  let data = ifa.ifa_data?.assumingMemoryBound(to: if_data.self).pointee else { continue }
            counters[String(cString: ifa.ifa_name)] = NetCounters(bytesIn: data.ifi_ibytes, bytesOut: data.ifi_obytes)
        }
        return counters
    }

    /// Bytes moved between two samples, summed per interface so one wrapping counter stays right.
    static func delta(from old: [String: NetCounters], to new: [String: NetCounters]) -> (bytesIn: Double, bytesOut: Double) {
        var bytesIn = 0.0
        var bytesOut = 0.0
        for (name, now) in new {
            guard let before = old[name] else { continue }
            bytesIn += Double(now.bytesIn &- before.bytesIn)
            bytesOut += Double(now.bytesOut &- before.bytesOut)
        }
        return (bytesIn, bytesOut)
    }
}

enum Memory {
    /// Used as Activity Monitor counts it: app memory + wired + compressed.
    static func used() -> Double {
        var stats = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &stats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) }
        }
        guard status == KERN_SUCCESS else { return 0 }
        let pages = UInt64(stats.internal_page_count) - UInt64(stats.purgeable_count) + UInt64(stats.wire_count) + UInt64(stats.compressor_page_count)
        return Double(pages) * Double(vm_kernel_page_size)
    }

    static var total: Double { Double(ProcessInfo.processInfo.physicalMemory) }
}

/// `stats` topic, sampled every 2 s while subscribed.
@MainActor
public final class StatsService: NotchService {
    public let topics = ["stats"]
    public weak var sink: ServiceSink?

    private var timer: Timer?
    private var cpu: CPUTicks?
    private var net: [String: NetCounters] = [:]
    private var sampledAt = Date()
    private var latest = Latest<StatsState>()

    public init() {}

    public func start(topic: String) {
        guard timer == nil else { return }
        baseline()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.sample() }
        }
    }

    public func stop(topic: String) {
        timer?.invalidate()
        timer = nil
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        latest.value?.json()
    }

    private func baseline() {
        cpu = CPUTicks.read()
        net = NetCounters.read()
        sampledAt = Date()
    }

    private func sample() {
        let previousCPU = cpu
        let previousNet = net
        let elapsed = Date().timeIntervalSince(sampledAt)
        baseline()

        let usage = if let previousCPU, let cpu { CPUTicks.usage(from: previousCPU, to: cpu) } else { 0.0 }
        let moved = NetCounters.delta(from: previousNet, to: net)
        let seconds = max(elapsed, 0.001)
        let state = StatsState(
            cpu: (usage * 1000).rounded() / 1000,
            memoryUsed: Memory.used(),
            memoryTotal: Memory.total,
            netInBps: (moved.bytesIn / seconds).rounded(),
            netOutBps: (moved.bytesOut / seconds).rounded()
        )
        guard latest.update(state), let data = state.json() else { return }
        sink?.publish(topic: "stats", value: data)
    }
}
