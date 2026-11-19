import Foundation
import UniformTypeIdentifiers

/// `files.search`: files and folders by name from the Spotlight index, home folder (iCloud Drive included, it
/// lives in `~/Library/Mobile Documents`). NSMetadataQuery needs a run loop, so this stays on the main actor.
@MainActor
public final class FileSearchService: NotchService {
    public let methods = ["files.search"]
    public weak var sink: ServiceSink?

    static let window: TimeInterval = 0.5
    private var current: FileSearch?

    public init() {}

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "files.search" else { throw ServiceError("unknown method \(method)") }
        let p = try decode(FileSearchParams.self, params)
        current?.finish(cancelled: true)
        current = nil
        // `*` and `?` are LIKE wildcards; a typed one would match everything.
        let words = p.query.split(whereSeparator: \.isWhitespace)
            .map { $0.replacingOccurrences(of: "*", with: "").replacingOccurrences(of: "?", with: "") }
            .filter { !$0.isEmpty }
        guard !words.isEmpty else { return [FileHit]().json() }
        let search = FileSearch(words: words, limit: min(max(p.limit ?? 20, 1), 200))
        current = search
        let hits = await search.run(within: Self.window)
        if current === search { current = nil }
        return hits.json()
    }
}

@MainActor
final class FileSearch {
    private static let packages: Set<String> = [
        "app", "appex", "bundle", "framework", "plugin", "kext", "xpc", "photoslibrary", "musiclibrary", "tvlibrary",
        "xcodeproj", "xcworkspace", "xcassets", "playground", "pkg", "lproj", "fcpbundle", "logicx", "band",
    ]
    private static let home = FileManager.default.homeDirectoryForCurrentUser.path
    private static let iso = ISO8601DateFormatter()

    private let query = NSMetadataQuery()
    private let limit: Int
    private var observer: NSObjectProtocol?
    private var continuation: CheckedContinuation<[FileHit], Never>?

    init(words: [String], limit: Int) {
        self.limit = limit
        query.searchScopes = [NSMetadataQueryUserHomeScope]
        let predicates = words.map { NSPredicate(format: "%K LIKE[cd] %@", NSMetadataItemDisplayNameKey, "*\($0)*") }
        // NSMetadataQuery throws on an AND of one.
        query.predicate = predicates.count == 1 ? predicates[0] : NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
        query.sortDescriptors = [
            NSSortDescriptor(key: NSMetadataItemLastUsedDateKey, ascending: false),
            NSSortDescriptor(key: NSMetadataItemContentModificationDateKey, ascending: false),
        ]
    }

    func run(within window: TimeInterval) async -> [FileHit] {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            observer = NotificationCenter.default.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.finish(cancelled: false) }
            }
            guard query.start() else { return finish(cancelled: true) }
            DispatchQueue.main.asyncAfter(deadline: .now() + window) { [weak self] in
                MainActor.assumeIsolated { self?.finish(cancelled: false) }
            }
        }
    }

    /// Answers with what the index gathered so far (nothing when a newer search replaced this one) and stops.
    func finish(cancelled: Bool) {
        guard let continuation else { return }
        self.continuation = nil
        if let observer { NotificationCenter.default.removeObserver(observer) }
        query.disableUpdates()
        let hits = cancelled ? [] : collect()
        query.stop()
        continuation.resume(returning: hits)
    }

    private func collect() -> [FileHit] {
        var hits: [FileHit] = []
        for i in 0 ..< query.resultCount where hits.count < limit {
            guard let item = query.result(at: i) as? NSMetadataItem, let hit = Self.hit(item) else { continue }
            hits.append(hit)
        }
        return hits
    }

    private static func hit(_ item: NSMetadataItem) -> FileHit? {
        guard let path = item.value(forAttribute: NSMetadataItemPathKey) as? String, !excluded(path) else { return nil }
        let name = item.value(forAttribute: NSMetadataItemDisplayNameKey) as? String ?? (path as NSString).lastPathComponent
        let type = (item.value(forAttribute: NSMetadataItemContentTypeKey) as? String).flatMap { UTType($0) }
        let kind = kind(type)
        return FileHit(
            path: path, name: name, kind: kind,
            modified: (item.value(forAttribute: NSMetadataItemContentModificationDateKey) as? Date).map { iso.string(from: $0) },
            lastUsed: (item.value(forAttribute: NSMetadataItemLastUsedDateKey) as? Date).map { iso.string(from: $0) },
            size: kind == .folder ? nil : (item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber)?.intValue
        )
    }

    /// Folders of tool output nobody looks for by name: dependencies, build products, caches.
    private static let toolFolders: Set<Substring> = ["node_modules", "bower_components", "Pods", "DerivedData", "build", "dist", "target", "vendor", "__pycache__", "venv"]

    /// `~/Library` (but iCloud Drive), hidden files, app bundles (`apps.index` lists those), anything inside a package,
    /// and anything inside dependency or build folders.
    static func excluded(_ path: String) -> Bool {
        if path.hasPrefix(home + "/Library/"), !path.hasPrefix(home + "/Library/Mobile Documents/") { return true }
        let parts = path.split(separator: "/")
        if parts.contains(where: { $0.hasPrefix(".") }) { return true }
        if parts.dropLast().contains(where: toolFolders.contains) { return true }
        if (path as NSString).pathExtension.lowercased() == "app" { return true }
        return parts.dropLast().contains { packages.contains((String($0) as NSString).pathExtension.lowercased()) }
    }

    static func kind(_ type: UTType?) -> FileHit.Kind {
        guard let type else { return .other }
        if type.conforms(to: .application) { return .application }
        if type.conforms(to: .folder) { return .folder }
        if type.conforms(to: .pdf) { return .pdf }
        if type.conforms(to: .image) { return .image }
        if [.text, .compositeContent, .spreadsheet, .presentation].contains(where: type.conforms) { return .document }
        return .other
    }
}
