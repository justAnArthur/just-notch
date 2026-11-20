import AppKit

/// `recentFiles` topic: the newest files in Downloads and the screenshot folder
/// (`com.apple.screencapture location`, Desktop by default), or the folders the
/// user chose instead, plus downloads still being written. Folders are watched with vnode sources while subscribed; an
/// active download adds a 1 s rescan so its progress moves.
///
/// Every touch of the folders runs off the main thread: they are privacy-protected,
/// and the first one blocks until the user answers macOS's prompt.
@MainActor
public final class RecentFilesService: NotchService {
    public let topics = ["recentFiles"]
    public let methods = ["recentFiles.clear", "recentFiles.chooseFolder", "recentFiles.resetFolder", "recentFiles.cancelDownload"]
    public weak var sink: ServiceSink?

    nonisolated static let perSource = 20
    nonisolated static let partialExtensions: Set<String> = ["download", "crdownload", "part"]
    private static func clearedKey(_ source: RecentFile.Source) -> String { "recentFiles.clearedAt.\(source.rawValue)" }
    nonisolated static func folderKey(_ source: RecentFile.Source) -> String { "recentFiles.folder.\(source.rawValue)" }

    typealias Partial = [String: (bytes: Double, at: Date)]

    private var watchers: [DispatchSourceFileSystemObject] = []
    private var progressTimer: Timer?
    private var pending: Task<Void, Never>?
    private var latest = Latest<RecentFilesState>()
    private var partial: Partial = [:]
    /// Bumped by start and stop, so work started for an earlier subscription is dropped.
    private var generation = 0
    private var scanning = false
    private var rescan = false
    private var subscribed = false

    public init() {}

    public func start(topic: String) {
        subscribed = true
        generation += 1
        let current = generation
        let folders = Set(Self.folders.map(\.url))
        Task {
            let descriptors = await Task.detached { folders.map { open($0.path, O_EVTONLY) }.filter { $0 >= 0 } }.value
            guard current == generation else { return descriptors.forEach { close($0) } }
            for fd in descriptors {
                let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: .main)
                source.setEventHandler { [weak self] in MainActor.assumeIsolated { self?.scheduleScan() } }
                source.setCancelHandler { close(fd) }
                source.resume()
                watchers.append(source)
            }
        }
        scan()
    }

    public func stop(topic: String) {
        subscribed = false
        generation += 1
        watchers.forEach { $0.cancel() }
        watchers = []
        progressTimer?.invalidate()
        progressTimer = nil
        pending?.cancel()
        pending = nil
        partial = [:]
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        latest.value?.json()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "recentFiles.clear":
            UserDefaults.standard.set(nowMs(), forKey: Self.clearedKey(try decode(SourceParams.self, params).source))
            if subscribed { scan() }
        case "recentFiles.chooseFolder":
            let source = try decode(SourceParams.self, params).source
            guard let url = await chooseFolder(source) else { return jsonNull }
            UserDefaults.standard.set(url.path, forKey: Self.folderKey(source))
            restart()
            return RecentFolder(path: url.path, custom: true).json()
        case "recentFiles.resetFolder":
            UserDefaults.standard.removeObject(forKey: Self.folderKey(try decode(SourceParams.self, params).source))
            restart()
        case "recentFiles.cancelDownload":
            let url = URL(fileURLWithPath: try decode(IdParams.self, params).id)
            let downloads = Self.folder(.downloads)
            try await Task.detached {
                guard Self.isPartial(url, in: downloads) else { throw ServiceError("no download under way at \(url.path)") }
                try FileManager.default.trashItem(at: url, resultingItemURL: nil)
            }.value
            if subscribed { scan() }
        default:
            throw ServiceError("unknown method \(method)")
        }
        return nil
    }

    private func chooseFolder(_ source: RecentFile.Source) async -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Watch"
        panel.message = source == .downloads ? "Choose the folder to watch for downloads." : "Choose the folder to watch for screenshots."
        // The app is an agent behind a non-activating island, so macOS may refuse to activate it:
        // the panel must not hide when the app is inactive, and must sit above the island
        // (main menu + 3) on the screen the pointer is on.
        panel.hidesOnDeactivate = false
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 4)
        if let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) {
            let size = panel.frame.size
            panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.midX - size.width / 2, y: screen.visibleFrame.midY - size.height / 2))
        }
        NSApp.activate()
        return await withCheckedContinuation { continuation in
            panel.begin { continuation.resume(returning: $0 == .OK ? panel.url : nil) }
            panel.orderFrontRegardless()
        }
    }

    /// Watchers and the last state belong to the old folders: start over.
    private func restart() {
        guard subscribed else { return }
        stop(topic: "recentFiles")
        start(topic: "recentFiles")
    }

    // MARK: scanning

    nonisolated static var folders: [(url: URL, source: RecentFile.Source)] {
        [(folder(.downloads), .downloads), (folder(.screenshots), .screenshots)]
    }

    /// The user's choice, else the system's folder.
    nonisolated static func folder(_ source: RecentFile.Source) -> URL {
        folder(source, custom: UserDefaults.standard.string(forKey: folderKey(source)))
    }

    nonisolated static func folder(_ source: RecentFile.Source, custom: String?) -> URL {
        if let custom { return URL(fileURLWithPath: custom, isDirectory: true).standardizedFileURL }
        let home = FileManager.default.homeDirectoryForCurrentUser
        switch source {
        case .downloads:
            let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? home.appendingPathComponent("Downloads")
            return downloads.standardizedFileURL
        case .screenshots:
            let configured = UserDefaults(suiteName: "com.apple.screencapture")?.string(forKey: "location")
            let screenshots = configured.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath, isDirectory: true) } ?? home.appendingPathComponent("Desktop")
            return screenshots.standardizedFileURL
        case .shelf:
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            return support.appendingPathComponent("JustNotch/Shelf", isDirectory: true)
        }
    }

    /// A partial download directly in the downloads folder: the only thing `recentFiles.cancelDownload` may trash.
    nonisolated static func isPartial(_ url: URL, in downloads: URL) -> Bool {
        partialExtensions.contains(url.pathExtension.lowercased())
            && url.standardizedFileURL.deletingLastPathComponent().path == downloads.standardizedFileURL.path
    }

    /// Bursts of folder events (a download renaming itself, Finder's metadata) collapse into one scan.
    private func scheduleScan() {
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            scan()
        }
    }

    /// One scan at a time; a request during one runs once it ends.
    private func scan() {
        guard !scanning else {
            rescan = true
            return
        }
        scanning = true
        let current = generation
        let previous = partial
        let cleared = Dictionary(uniqueKeysWithValues: [RecentFile.Source.downloads, .screenshots].map {
            ($0, UserDefaults.standard.double(forKey: Self.clearedKey($0)))
        })
        Task {
            let (state, next) = await Task.detached { Self.read(previous: previous, cleared: cleared, now: Date()) }.value
            scanning = false
            guard current == generation else { return }
            partial = next
            trackProgress(!state.downloads.isEmpty)
            if latest.update(state), let data = state.json() { sink?.publish(topic: "recentFiles", value: data) }
            if rescan {
                rescan = false
                scan()
            }
        }
    }

    nonisolated static func read(previous: Partial, cleared: [RecentFile.Source: Double], now: Date) -> (RecentFilesState, Partial) {
        let folders = Self.folders
        var files: [RecentFile] = []
        var downloads: [ActiveDownload] = []
        var denied = false
        var partial: Partial = [:]

        for folder in Set(folders.map(\.url)) {
            let keys: [URLResourceKey] = [.addedToDirectoryDateKey, .creationDateKey, .fileSizeKey, .isDirectoryKey, .isPackageKey, .totalFileAllocatedSizeKey]
            guard let entries = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) else {
                denied = true
                continue
            }
            let isDownloads = folders.contains { $0.url == folder && $0.source == .downloads }
            let isScreenshots = folders.contains { $0.url == folder && $0.source == .screenshots }
            for url in entries {
                guard let values = try? url.resourceValues(forKeys: Set(keys)) else { continue }
                let path = url.path
                if isDownloads, partialExtensions.contains(url.pathExtension.lowercased()) {
                    let bytes = Double(values.isDirectory == true ? size(of: url) : values.fileSize ?? 0)
                    let rate = previous[path].map { max(bytes - $0.bytes, 0) / max(now.timeIntervalSince($0.at), 0.001) } ?? 0
                    partial[path] = (bytes, now)
                    downloads.append(ActiveDownload(
                        id: path, name: url.deletingPathExtension().lastPathComponent, received: bytes,
                        total: expectedSize(of: url), rate: rate.rounded(), from: origin(of: url)
                    ))
                    continue
                }
                guard values.isDirectory != true || values.isPackage == true else { continue }
                let screenshot = isScreenshots && isScreenCapture(url)
                guard screenshot || isDownloads else { continue }
                let added = values.addedToDirectoryDate ?? values.creationDate ?? .distantPast
                files.append(RecentFile(
                    id: path, name: url.lastPathComponent,
                    size: Double(values.fileSize ?? values.totalFileAllocatedSize ?? 0),
                    addedAt: (added.timeIntervalSince1970 * 1000).rounded(),
                    source: screenshot ? .screenshots : .downloads,
                    from: screenshot ? nil : origin(of: url)
                ))
            }
        }

        let recent = [RecentFile.Source.downloads, .screenshots].flatMap { source in
            files.filter { $0.source == source && $0.addedAt > cleared[source, default: 0] }
                .sorted { $0.addedAt > $1.addedAt }
                .prefix(perSource)
        }
        let defaults = UserDefaults.standard
        let state = RecentFilesState(
            access: denied ? .denied : .granted,
            files: recent.sorted { $0.addedAt > $1.addedAt },
            downloads: downloads.sorted { $0.name < $1.name },
            folders: .init(
                downloads: RecentFolder(path: folders[0].url.path, custom: defaults.string(forKey: folderKey(.downloads)) != nil),
                screenshots: RecentFolder(path: folders[1].url.path, custom: defaults.string(forKey: folderKey(.screenshots)) != nil)
            )
        )
        return (state, partial)
    }

    private func trackProgress(_ active: Bool) {
        guard active != (progressTimer != nil) else { return }
        progressTimer?.invalidate()
        progressTimer = nil
        guard active else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.scan() } }
        RunLoop.main.add(timer, forMode: .common)
        progressTimer = timer
    }

    // MARK: file metadata

    /// Safari's `.download` is a bundle; what's been received is the size of what's inside.
    private nonisolated static func size(of folder: URL) -> Int {
        let items = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.fileSizeKey])
        return (items?.allObjects as? [URL] ?? []).reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }

    /// Safari's `.download` bundle records the expected size in its Info.plist; other browsers don't say.
    nonisolated static func expectedSize(of url: URL) -> Double? {
        guard let info = NSDictionary(contentsOf: url.appendingPathComponent("Info.plist")),
              let total = info["DownloadEntryProgressTotalToLoad"] as? NSNumber, total.doubleValue > 0 else { return nil }
        return total.doubleValue
    }

    nonisolated static func isScreenCapture(_ url: URL) -> Bool {
        getxattr(url.path, "com.apple.metadata:kMDItemIsScreenCapture", nil, 0, 0, 0) > 0
    }

    /// The host of the page a file was downloaded from (`kMDItemWhereFroms`: the file's URL, then the referrer).
    nonisolated static func origin(of url: URL) -> String? {
        let name = "com.apple.metadata:kMDItemWhereFroms"
        let length = getxattr(url.path, name, nil, 0, 0, 0)
        guard length > 0 else { return nil }
        var data = Data(count: length)
        let read = data.withUnsafeMutableBytes { getxattr(url.path, name, $0.baseAddress, length, 0, 0) }
        guard read == length, let froms = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String] else { return nil }
        return froms.lazy.compactMap { URL(string: $0)?.host }.first.map { $0.hasPrefix("www.") ? String($0.dropFirst(4)) : $0 }
    }
}
