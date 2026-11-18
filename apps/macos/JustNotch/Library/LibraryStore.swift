import CryptoKit
import Foundation
import NotchServices

/// `Library/installed.json`: `{id: {version, sha256, installedAt}}` for the plugins installed from the library.
enum LibraryRecords {
    struct Record: Codable, Equatable {
        var version: String
        var sha256: String
        var installedAt: String
    }

    private static let file = Paths.library.appendingPathComponent("installed.json")

    static func load() -> [String: Record] {
        guard let data = try? Data(contentsOf: file) else { return [:] }
        return (try? JSONDecoder().decode([String: Record].self, from: data)) ?? [:]
    }

    static func save(_ records: [String: Record]) throws {
        try FileManager.default.createDirectory(at: Paths.library, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(records).write(to: file, options: .atomic)
    }
}

/// The plugin library: its catalog (cached in memory and in `Library/catalog.json`), and verified installs, updates
/// and uninstalls. The page only ever names an id: what to download, its size and hash come from the catalog.
@MainActor
final class LibraryStore {
    static let catalogURL = URL(string: "https://justanarthur.github.io/just-notch/library/index.json")!
    static let releases = URL(string: "https://github.com/justAnArthur/just-notch/releases/download/")!
    private static let maxCatalogBytes = 2 * 1024 * 1024

    var onProgress: ((LibraryProgress) -> Void)?

    private let plugins: PluginStore
    private let storage: Storage
    private let secrets: SecretsStore
    private let net: NetAccess
    private var catalog: LibraryCatalog?
    private var busy: Set<String> = []
    private var phases: [String: LibraryProgress.Phase] = [:]
    private let session: URLSession
    private let cacheFile = Paths.library.appendingPathComponent("catalog.json")

    init(plugins: PluginStore, storage: Storage, secrets: SecretsStore, net: NetAccess, version: String) {
        self.plugins = plugins
        self.storage = storage
        self.secrets = secrets
        self.net = net
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpAdditionalHeaders = ["User-Agent": "JustNotch/\(version)"]
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
        catalog = (try? Data(contentsOf: cacheFile)).flatMap { try? JSONDecoder().decode(LibraryCatalog.self, from: $0) }
    }

    /// The catalog's URL. Debug builds take `NOTCH_LIBRARY_URL` or the `library.url` default, for a local catalog.
    var catalogURL: URL {
        #if DEBUG
        let override = ProcessInfo.processInfo.environment["NOTCH_LIBRARY_URL"] ?? UserDefaults.standard.string(forKey: "library.url")
        if let override, let url = URL(string: override), url.scheme == "https" || url.scheme == "http" { return url }
        #endif
        return Self.catalogURL
    }

    /// Release assets of this repo only (debug builds: also the overridden catalog's origin).
    func downloadAllowed(_ url: URL) -> Bool {
        guard url.user == nil, !url.pathComponents.contains(where: { $0 == ".." || $0 == "." }) else { return false }
        // The prefix ends in a path, so it pins the scheme, the host and the port too.
        if url.absoluteString.hasPrefix(Self.releases.absoluteString) { return true }
        #if DEBUG
        let catalog = catalogURL
        if catalog != Self.catalogURL, url.scheme == catalog.scheme, url.host == catalog.host, url.port == catalog.port { return true }
        #endif
        return false
    }

    // MARK: catalog

    func catalog(refresh: Bool) async throws -> LibraryCatalog {
        if !refresh, let catalog { return catalog }
        do {
            let fetched = try await fetchCatalog()
            catalog = fetched
            try? FileManager.default.createDirectory(at: Paths.library, withIntermediateDirectories: true)
            try? JSONEncoder().encode(fetched).write(to: cacheFile, options: .atomic)
            return fetched
        } catch {
            // Offline: the last catalog still lists what can be installed.
            if let catalog { return catalog }
            throw error
        }
    }

    private func fetchCatalog() async throws -> LibraryCatalog {
        let (data, response) = try await session.data(from: catalogURL)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw ServiceError("the library answered \((response as? HTTPURLResponse)?.statusCode ?? 0)") }
        guard data.count <= Self.maxCatalogBytes else { throw ServiceError("the library's catalog is too large") }
        var catalog: LibraryCatalog
        do {
            catalog = try JSONDecoder().decode(LibraryCatalog.self, from: data)
        } catch {
            throw ServiceError("the library's catalog is malformed")
        }
        guard catalog.schema == 1 else { throw ServiceError("the library's catalog needs a newer Just Notch") }
        var seen = Set<String>()
        catalog.plugins = catalog.plugins.filter { Paths.isPluginId($0.id) && seen.insert($0.id).inserted }
        return catalog
    }

    // MARK: install

    /// Installs or updates `id` from the catalog, then answers with it as installed.
    func install(_ id: String) async throws -> InstalledPlugin {
        guard busy.insert(id).inserted else { throw ServiceError("\(id) is already being installed") }
        defer {
            busy.remove(id)
            phases[id] = nil
        }
        do {
            let plugin = try await performInstall(id)
            progress(id, .done, 1)
            return plugin
        } catch {
            progress(id, .error, message: error.localizedDescription)
            throw error
        }
    }

    private func performInstall(_ id: String) async throws -> InstalledPlugin {
        var entry = try await catalog(refresh: false).plugins.first { $0.id == id }
        if entry == nil { entry = try await catalog(refresh: true).plugins.first { $0.id == id } }
        guard let entry else { throw ServiceError("\(id) isn't in the library") }
        guard let url = URL(string: entry.download.url), downloadAllowed(url) else {
            throw ServiceError("\(id)'s download isn't a Just Notch release")
        }
        guard entry.download.size > 0, entry.download.size <= PluginArchive.maxTotalBytes else { throw ServiceError("\(id) is too large") }
        if FileManager.default.fileExists(atPath: Paths.builtInPlugins.appendingPathComponent(id).path) {
            throw ServiceError("\(id) is a built-in plugin")
        }

        try FileManager.default.createDirectory(at: Paths.staging, withIntermediateDirectories: true)
        let staging = Paths.staging.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: staging) }

        progress(id, .downloading, 0)
        let file = staging.appendingPathComponent("download.notchplugin")
        try await Self.download(url, size: entry.download.size, to: file, session: session) { [weak self] fraction in
            // Hops can land after the next phase began: only while it's still downloading.
            Task { @MainActor in if self?.phases[id] == .downloading { self?.progress(id, .downloading, fraction) } }
        }

        progress(id, .verifying)
        let data = try Data(contentsOf: file)
        guard data.count == entry.download.size else { throw ServiceError("\(id): the download is \(data.count) bytes, the library says \(entry.download.size)") }
        let sha256 = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard sha256 == entry.download.sha256.lowercased() else { throw ServiceError("\(id): the download doesn't match the library's checksum") }

        let folder = staging.appendingPathComponent(id, isDirectory: true)
        let manifest = try await Task.detached { () throws -> PluginManifest in
            let archive = try PluginArchive(data)
            let manifest: PluginManifest
            do {
                manifest = try JSONDecoder().decode(PluginManifest.self, from: try archive.read("manifest.json"))
            } catch let error as ArchiveError {
                throw error
            } catch {
                throw ServiceError("\(id): its manifest.json is invalid")
            }
            try archive.extract(to: folder, icon: manifest.icon)
            return manifest
        }.value

        guard manifest.id == entry.id, manifest.version == entry.version,
              Set(manifest.permissions.map(\.rawValue)) == Set(entry.permissions), Set(manifest.hosts ?? []) == Set(entry.hosts) else {
            throw ServiceError("\(id): the package doesn't match its library entry")
        }
        if let reason = PluginStore.incompatibility(manifest) { throw ServiceError(reason) }

        let destination = Paths.userPlugins.appendingPathComponent(id, isDirectory: true)
        let previous = (try? Data(contentsOf: destination.appendingPathComponent("manifest.json")))
            .flatMap { try? JSONDecoder().decode(PluginManifest.self, from: $0) }
        let permissions = manifest.permissions.map(\.rawValue).filter { permission in !(previous?.permissions.contains { $0.rawValue == permission } ?? false) }
        let hosts = (manifest.hosts ?? []).filter { !(previous?.hosts ?? []).contains($0) }
        guard Consent.install(name: manifest.name, version: manifest.version, author: entry.author,
                              permissions: permissions, hosts: hosts, update: previous != nil) else {
            throw ServiceError("cancelled")
        }

        progress(id, .installing)
        try FileManager.default.createDirectory(at: Paths.userPlugins, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: folder)
        } else {
            try FileManager.default.moveItem(at: folder, to: destination)
            plugins.forget(id)
        }
        var records = LibraryRecords.load()
        records[id] = .init(version: manifest.version, sha256: sha256, installedAt: Date().ISO8601Format())
        try LibraryRecords.save(records)

        plugins.reload()
        guard let installed = plugins.plugins.first(where: { $0.manifest.id == id }) else { throw ServiceError("\(id) didn't load") }
        return installed
    }

    /// Streams `url` into `file`, never past `size` bytes, reporting the fraction received.
    nonisolated private static func download(_ url: URL, size: Int, to file: URL, session: URLSession,
                                             progress: @escaping @Sendable (Double) -> Void) async throws {
        let (bytes, response) = try await session.bytes(from: url)
        guard let status = (response as? HTTPURLResponse)?.statusCode, status == 200 else {
            throw ServiceError("the download answered \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }
        guard FileManager.default.createFile(atPath: file.path, contents: nil) else { throw ServiceError("can't write the download") }
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        let chunk = 64 * 1024
        var buffer = Data(capacity: chunk)
        var received = 0
        for try await byte in bytes {
            received += 1
            guard received <= size else { throw ServiceError("the download is larger than the library says") }
            buffer.append(byte)
            if buffer.count == chunk {
                try handle.write(contentsOf: buffer)
                buffer.removeAll(keepingCapacity: true)
                progress(Double(received) / Double(size))
            }
        }
        try handle.write(contentsOf: buffer)
        progress(Double(received) / Double(size))
    }

    // MARK: uninstall

    /// Asks, then moves a user or library plugin to the Trash; its data goes too when the user ticks the box.
    func uninstall(_ id: String) async throws {
        guard let plugin = plugins.plugins.first(where: { $0.manifest.id == id }) else { throw ServiceError("unknown plugin \(id)") }
        guard plugin.source != .builtIn else { throw ServiceError("\(id) is a built-in plugin: turn it off instead") }
        guard !busy.contains(id) else { throw ServiceError("\(id) is being installed") }
        let answer = Consent.uninstall(name: plugin.manifest.name)
        guard answer.confirmed else { throw ServiceError("cancelled") }

        let folder = Paths.userPlugins.appendingPathComponent(id, isDirectory: true)
        if FileManager.default.fileExists(atPath: folder.path) { try FileManager.default.trashItem(at: folder, resultingItemURL: nil) }
        var records = LibraryRecords.load()
        if records.removeValue(forKey: id) != nil { try LibraryRecords.save(records) }
        if answer.deleteData {
            try await secrets.deleteAll(plugin: id)
            try storage.deleteAll(plugin: id)
            net.revokeAll(plugin: id)
            plugins.forget(id)
        }
        plugins.reload()
    }

    private func progress(_ id: String, _ phase: LibraryProgress.Phase, _ fraction: Double? = nil, message: String? = nil) {
        phases[id] = phase
        onProgress?(LibraryProgress(id: id, phase: phase, progress: fraction.map { min(1, max(0, $0)) }, message: message))
    }
}
