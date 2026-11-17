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

    static func pressure() -> StatsState.Pressure {
        var level: Int32 = 0
        var size = MemoryLayout<Int32>.size
        guard sysctlbyname("kern.memorystatus_vm_pressure_level", &level, &size, nil, 0) == 0 else { return .normal }
        return switch level {
        case 4: .critical
        case 2: .warning
        default: .normal
        }
    }
}

enum Disk {
    /// Startup volume; available counts purgeable space, as Finder shows it.
    static func read() -> (free: Double, total: Double) {
        let values = try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey])
        return (Double(values?.volumeAvailableCapacityForImportantUsage ?? 0), Double(values?.volumeTotalCapacity ?? 0))
    }
}

/// CPU time per process. Processes of other users can't be read and are skipped.
struct ProcessTimes {
    struct Entry { var name: String; var cpuNs: Double; var memory: Double }

    var entries: [Int32: Entry] = [:]
    var at = Date()

    private static let nsPerTick: Double = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return Double(info.numer) / Double(info.denom)
    }()

    static func read() -> ProcessTimes {
        let capacity = Int(proc_listallpids(nil, 0)) + 32
        var pids = [Int32](repeating: 0, count: capacity)
        let count = Int(proc_listallpids(&pids, Int32(capacity * MemoryLayout<Int32>.size)))
        var times = ProcessTimes()
        var info = proc_taskinfo()
        let infoSize = Int32(MemoryLayout<proc_taskinfo>.size)
        var name = [CChar](repeating: 0, count: 256)
        for pid in pids.prefix(max(count, 0)) where pid > 0 {
            guard proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, infoSize) == infoSize else { continue }
            guard proc_name(pid, &name, UInt32(name.count)) > 0 else { continue }
            let ticks = Double(info.pti_total_user + info.pti_total_system)
            times.entries[pid] = Entry(name: String(cString: name), cpuNs: ticks * nsPerTick, memory: Double(info.pti_resident_size))
        }
        return times
    }

    /// The busiest processes between two reads, as shares of all cores.
    static func top(_ limit: Int, from old: ProcessTimes, to new: ProcessTimes) -> [ProcessSample] {
        let budget = max(new.at.timeIntervalSince(old.at), 0.001) * 1e9 * Double(ProcessInfo.processInfo.activeProcessorCount)
        return new.entries.compactMap { pid, entry -> ProcessSample? in
            guard let before = old.entries[pid] else { return nil }
            let cpu = max(entry.cpuNs - before.cpuNs, 0) / budget
            return ProcessSample(pid: pid, name: entry.name, cpu: (cpu * 1000).rounded() / 1000, memory: entry.memory)
        }
        .sorted { $0.cpu != $1.cpu ? $0.cpu > $1.cpu : $0.memory > $1.memory }
        .prefix(limit)
        .map { $0 }
    }
}

/// `stats` and `processes` topics, sampled every 2 s while either is subscribed.
/// CPU, network and per-process CPU are deltas between two samples, so the
/// first value follows the baseline by 1 s.
@MainActor
public final class StatsService: NotchService {
    public let topics = ["stats", "processes"]
    public weak var sink: ServiceSink?

    static let firstSample: TimeInterval = 1
    static let interval: TimeInterval = 2
    static let topProcesses = 8

    private var active: Set<String> = []
    private var timer: Timer?
    private var cpu: CPUTicks?
    private var net: [String: NetCounters] = [:]
    private var processes: ProcessTimes?
    private var sampledAt = Date()
    private var latest = Latest<StatsState>()
    private var latestProcesses = Latest<[ProcessSample]>()

    public init() {}

    public func start(topic: String) {
        active.insert(topic)
        if topic == "processes" { processes = ProcessTimes.read() }
        guard timer == nil else { return }
        baseline()
        let timer = Timer(fire: Date(timeIntervalSinceNow: Self.firstSample), interval: Self.interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.sample() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    public func stop(topic: String) {
        active.remove(topic)
        if topic == "processes" {
            processes = nil
            latestProcesses.reset()
        } else {
            latest.reset()
        }
        guard active.isEmpty else { return }
        timer?.invalidate()
        timer = nil
    }

    public func snapshot(topic: String) async -> Data? {
        topic == "processes" ? latestProcesses.value?.json() : latest.value?.json()
    }

    private func baseline() {
        cpu = CPUTicks.read()
        net = NetCounters.read()
        sampledAt = Date()
    }

    private func sample() {
        if active.contains("stats") { sampleStats() }
        if active.contains("processes") { sampleProcesses() }
    }

    private func sampleStats() {
        let previousCPU = cpu
        let previousNet = net
        let elapsed = Date().timeIntervalSince(sampledAt)
        baseline()

        let usage = if let previousCPU, let cpu { CPUTicks.usage(from: previousCPU, to: cpu) } else { 0.0 }
        let moved = NetCounters.delta(from: previousNet, to: net)
        let seconds = max(elapsed, 0.001)
        let disk = Disk.read()
        let state = StatsState(
            cpu: (usage * 1000).rounded() / 1000,
            memoryUsed: Memory.used(),
            memoryTotal: Memory.total,
            memoryPressure: Memory.pressure(),
            netInBps: (moved.bytesIn / seconds).rounded(),
            netOutBps: (moved.bytesOut / seconds).rounded(),
            diskFree: disk.free,
            diskTotal: disk.total,
            uptimeS: ProcessInfo.processInfo.systemUptime.rounded()
        )
        guard latest.update(state), let data = state.json() else { return }
        sink?.publish(topic: "stats", value: data)
    }

    private func sampleProcesses() {
        let now = ProcessTimes.read()
        defer { processes = now }
        guard let processes else { return }
        let top = ProcessTimes.top(Self.topProcesses, from: processes, to: now)
        guard latestProcesses.update(top), let data = top.json() else { return }
        sink?.publish(topic: "processes", value: data)
    }
}
