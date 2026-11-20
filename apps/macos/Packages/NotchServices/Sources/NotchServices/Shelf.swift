import Foundation

/// Files the user dropped on the notch to keep: copies (APFS clones, so nearly free on the same volume) under
/// `root`, one folder per item so names never collide. Bounded twice: items older than the expiry go, and past
/// `limitBytes` the oldest go first. Never touches the originals.
struct Shelf: Sendable {
    let root: URL

    /// 2 GB, decimal, as Finder and the kit count.
    static let defaultLimit: Double = 2_000_000_000
    static let defaultExpiryHours: Double? = 24

    static var standard: Shelf {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return Shelf(root: support.appendingPathComponent("JustNotch/Shelf", isDirectory: true))
    }

    struct Item: Equatable, Sendable {
        /// The kept copy.
        let url: URL
        let bytes: Double
        /// Epoch ms.
        let addedAt: Double
    }

    struct Outcome: Equatable, Sendable {
        var kept: [String] = []
        var skipped: [String] = []
    }

    /// Everything kept, newest first.
    func items() -> [Item] {
        let fm = FileManager.default
        let folders = (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles])) ?? []
        return folders.compactMap { folder -> Item? in
            guard let file = (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]))?.first else { return nil }
            let created = (try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            return Item(url: file, bytes: Self.size(of: file), addedAt: (created.timeIntervalSince1970 * 1000).rounded())
        }
        .sorted { $0.addedAt > $1.addedAt }
    }

    /// Copies `urls` in; a file bigger than `limitBytes`, missing, or already on the shelf is skipped. Then trims.
    func keep(_ urls: [URL], limitBytes: Double, now: Date = Date()) -> Outcome {
        let fm = FileManager.default
        var outcome = Outcome()
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        for url in urls {
            let source = url.standardizedFileURL
            guard fm.fileExists(atPath: source.path), !source.path.hasPrefix(root.standardizedFileURL.path + "/"),
                  Self.size(of: source) <= limitBytes else {
                outcome.skipped.append(url.path)
                continue
            }
            let folder = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try fm.createDirectory(at: folder, withIntermediateDirectories: false)
                try fm.setAttributes([.creationDate: now], ofItemAtPath: folder.path)
                let copy = folder.appendingPathComponent(source.lastPathComponent)
                try fm.copyItem(at: source, to: copy)
                outcome.kept.append(copy.path)
            } catch {
                try? fm.removeItem(at: folder)
                outcome.skipped.append(url.path)
            }
        }
        trim(limitBytes: limitBytes, expiryHours: nil, now: now)
        return outcome
    }

    /// Drops what expired, then the oldest until the shelf fits in `limitBytes`.
    func trim(limitBytes: Double, expiryHours: Double?, now: Date = Date()) {
        let fm = FileManager.default
        // A copy moved to the Trash (`files.trash`) leaves its folder behind.
        for folder in (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
        where (try? fm.contentsOfDirectory(atPath: folder.path))?.filter({ !$0.hasPrefix(".") }).isEmpty == true {
            try? fm.removeItem(at: folder)
        }
        var items = items()
        if let expiryHours {
            let cutoff = (now.timeIntervalSince1970 - expiryHours * 3600) * 1000
            for item in items where item.addedAt < cutoff { remove(item.url) }
            items.removeAll { $0.addedAt < cutoff }
        }
        var total = items.reduce(0) { $0 + $1.bytes }
        for item in items.reversed() where total > limitBytes {
            remove(item.url)
            total -= item.bytes
        }
    }

    /// Whether `path` is a kept copy: only those may be deleted outright.
    func contains(_ path: String) -> Bool {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        return url.deletingLastPathComponent().deletingLastPathComponent().path == root.standardizedFileURL.path
    }

    /// Deletes a kept copy with its folder.
    func remove(_ url: URL) {
        guard contains(url.path) else { return }
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    func removeAll() {
        for item in items() { remove(item.url) }
    }

    /// Bytes on the shelf.
    func bytes() -> Double {
        items().reduce(0) { $0 + $1.bytes }
    }

    static func size(of url: URL) -> Double {
        let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
        guard values?.isDirectory == true else { return Double(values?.fileSize ?? 0) }
        let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey])?.allObjects as? [URL] ?? []
        return files.reduce(0) { $0 + Double((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }
}
