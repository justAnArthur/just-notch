import CoreServices
import Foundation
import NotchServices
import os

/// Built-in plugins (Resources/Web/plugins) and user plugins (Application Support/JustNotch/Plugins).
/// A user plugin whose `engines.notch` doesn't admit the plugin API version is listed as incompatible; the runtime skips it.
@MainActor
final class PluginStore {
    private static let enabledKey = "plugins.enabled"

    private(set) var plugins: [InstalledPlugin] = []
    var onChange: (() -> Void)?

    private let baseUrl: String
    private var stream: FSEventStreamRef?

    /// `origin` is `notch://app` in prod or the dev server's origin.
    init(origin: String) {
        baseUrl = origin + "/plugins/"
        plugins = scan()
    }

    func manifest(_ id: String) -> PluginManifest? {
        plugins.first { $0.manifest.id == id }?.manifest
    }

    func incompatible(_ id: String) -> String? {
        plugins.first { $0.manifest.id == id }?.incompatible
    }

    /// The host's wording, mirrored by the mock host.
    static func incompatibility(_ manifest: PluginManifest) -> String? {
        Semver.satisfies(Semver.apiVersion, manifest.engines.notch) ? nil
            : "Needs plugin API \(manifest.engines.notch); this Just Notch has \(Semver.apiVersion)."
    }

    func setEnabled(_ id: String, _ enabled: Bool) {
        var states = UserDefaults.standard.dictionary(forKey: Self.enabledKey) as? [String: Bool] ?? [:]
        states[id] = enabled
        UserDefaults.standard.set(states, forKey: Self.enabledKey)
        reload()
    }

    /// Uninstalling with its data: its on/off state goes too, so a reinstall starts enabled.
    func forget(_ id: String) {
        var states = UserDefaults.standard.dictionary(forKey: Self.enabledKey) as? [String: Bool] ?? [:]
        states[id] = nil
        UserDefaults.standard.set(states, forKey: Self.enabledKey)
    }

    func reload() {
        let next = scan()
        guard next != plugins else { return }
        plugins = next
        onChange?()
    }

    func watch() {
        try? FileManager.default.createDirectory(at: Paths.userPlugins, withIntermediateDirectories: true)
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let store = Unmanaged<PluginStore>.fromOpaque(info).takeUnretainedValue()
            MainActor.assumeIsolated { store.reload() }
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer)
        guard let stream = FSEventStreamCreate(nil, callback, &context, [Paths.userPlugins.path] as CFArray,
                                               FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3, flags) else { return }
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
        self.stream = stream
    }

    private func scan() -> [InstalledPlugin] {
        let states = UserDefaults.standard.dictionary(forKey: Self.enabledKey) as? [String: Bool] ?? [:]
        let library = LibraryRecords.load()
        var seen = Set<String>()
        var result: [InstalledPlugin] = []
        for (folder, builtIn) in [(Paths.builtInPlugins, true), (Paths.userPlugins, false)] {
            for manifest in manifests(in: folder) where seen.insert(manifest.id).inserted {
                result.append(InstalledPlugin(manifest: manifest, baseUrl: baseUrl + manifest.id + "/",
                                              enabled: states[manifest.id] ?? manifest.defaultEnabled ?? true, builtIn: builtIn,
                                              source: builtIn ? .builtIn : library[manifest.id] != nil ? .library : .user,
                                              incompatible: builtIn ? nil : Self.incompatibility(manifest)))
            }
        }
        return result
    }

    private func manifests(in folder: URL) -> [PluginManifest] {
        let ids = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return ids.sorted().compactMap { id in
            let url = folder.appendingPathComponent(id).appendingPathComponent("manifest.json")
            guard let data = try? Data(contentsOf: url) else { return nil }
            do {
                let manifest = try JSONDecoder().decode(PluginManifest.self, from: data)
                guard manifest.id == id, Paths.isPluginId(id) else {
                    log.error("plugin \(id, privacy: .public): manifest id must match its kebab-case folder name")
                    return nil
                }
                return manifest
            } catch {
                log.error("plugin \(id, privacy: .public): invalid manifest.json: \(error, privacy: .public)")
                return nil
            }
        }
    }
}

let log = Logger(subsystem: "com.justanarthur.justnotch", category: "host")
