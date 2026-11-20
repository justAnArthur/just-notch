import Foundation
import NotchServices

/// Per-plugin JSON storage: one file per plugin in Application Support/JustNotch/Storage/<plugin>.json.
@MainActor
final class Storage {
    private let directory = Paths.support.appendingPathComponent("Storage", isDirectory: true)
    private var cache: [String: [String: Any]] = [:]

    func get(plugin: String, key: String) throws -> Data {
        let value = try values(plugin)[key] ?? NSNull()
        return try JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)
    }

    func set(plugin: String, key: String, value: Any) throws {
        var values = try values(plugin)
        values[key] = value
        cache[plugin] = values
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: try file(plugin), options: .atomic)
    }

    /// Uninstalling with its data.
    func deleteAll(plugin: String) throws {
        cache[plugin] = nil
        let url = try file(plugin)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    private func values(_ plugin: String) throws -> [String: Any] {
        if let cached = cache[plugin] { return cached }
        let url = try file(plugin)
        guard let data = try? Data(contentsOf: url) else { return [:] }
        let values = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        cache[plugin] = values
        return values
    }

    private func file(_ plugin: String) throws -> URL {
        guard Paths.isPluginId(plugin) else { throw ServiceError("invalid plugin id \(plugin)") }
        return directory.appendingPathComponent("\(plugin).json")
    }
}

enum Paths {
    static let support = AppSupport.folder
    static let userPlugins = support.appendingPathComponent("Plugins", isDirectory: true)
    /// The library's catalog cache and `installed.json`.
    static let library = support.appendingPathComponent("Library", isDirectory: true)
    /// Downloads and extractions on their way into `userPlugins`: same volume, so the swap is a rename.
    static let staging = support.appendingPathComponent("Staging", isDirectory: true)
    static let web = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
    static let builtInPlugins = web.appendingPathComponent("plugins", isDirectory: true)

    /// Kebab-case ids only, so an id can never escape its folder.
    static func isPluginId(_ id: String) -> Bool {
        id.range(of: #"^[a-z0-9]+(-[a-z0-9]+)*$"#, options: .regularExpression) != nil
    }
}
