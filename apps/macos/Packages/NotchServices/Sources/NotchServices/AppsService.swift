import AppKit

/// `apps.list` (apps to pick, with small icons), `apps.index` (every app the launcher can open), `apps.icons`
/// and `apps.launch`.
@MainActor
public final class AppsService: NotchService {
    public let methods = ["apps.list", "apps.index", "apps.icons", "apps.launch"]
    public weak var sink: ServiceSink?

    /// A scan takes tens of milliseconds; the launcher asks on every open, so a recent one is reused.
    private static let indexTTL: TimeInterval = 30
    private var index: (apps: [AppInfo], at: Date)?
    private var icons: [String: String] = [:]

    public init() {}

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "apps.list":
            return await InstalledApps.list().json()
        case "apps.index":
            if let index, Date().timeIntervalSince(index.at) < Self.indexTTL { return index.apps.json() }
            let apps = await InstalledApps.index()
            index = (apps, Date())
            return apps.json()
        case "apps.icons":
            let p = try decode(IconsParams.self, params)
            let side = min(max(p.size ?? 64, 16), 256)
            var result: [String: String] = [:]
            var missing: [String] = []
            for path in p.paths {
                if let icon = icons["\(side):\(path)"] { result[path] = icon } else { missing.append(path) }
            }
            let fresh = await Task.detached { missing.compactMap { path in InstalledApps.icon(URL(fileURLWithPath: path), side: side).map { (path, $0) } } }.value
            for (path, icon) in fresh {
                icons["\(side):\(path)"] = icon
                result[path] = icon
            }
            return result.json()
        case "apps.launch":
            let path = try decode(PathParams.self, params).path
            let url = URL(fileURLWithPath: path)
            guard url.pathExtension == "app", FileManager.default.fileExists(atPath: path) else { throw ServiceError("no app at \(path)") }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
            return nil
        default:
            throw ServiceError("unknown method \(method)")
        }
    }
}

struct IconsParams: Decodable {
    var paths: [String]
    var size: Int?
}
