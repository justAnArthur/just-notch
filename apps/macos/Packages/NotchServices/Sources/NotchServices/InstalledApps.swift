import AppKit

/// `apps.list`: the apps a user can pick, running regular apps first, then the
/// ones in the Applications folders. Folders and icons are read off the main thread.
enum InstalledApps {
    static var folders: [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities"]
            .map { URL(fileURLWithPath: $0, isDirectory: true) } + [home.appendingPathComponent("Applications", isDirectory: true)]
    }

    @MainActor static func list() async -> [AppInfo] {
        let running = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.compactMap { app -> Entry? in
            guard let id = app.bundleIdentifier, let url = app.bundleURL else { return nil }
            return Entry(app: AppInfo(bundleId: id, name: app.localizedName ?? name(url)), url: url)
        }
        let own = Bundle.main.bundleIdentifier
        return await Task.detached {
            let entries = merge(running + installed()).filter { $0.app.bundleId != own }
            return entries.map { entry in
                var app = entry.app
                app.icon = icon(entry.url)
                return app
            }
        }.value
    }

    struct Entry: Sendable {
        var app: AppInfo
        var url: URL
    }

    /// One entry per bundle id (the first wins), sorted by name.
    static func merge(_ entries: [Entry]) -> [Entry] {
        var seen = Set<String>()
        return entries.filter { seen.insert($0.app.bundleId).inserted }
            .sorted { $0.app.name.localizedStandardCompare($1.app.name) == .orderedAscending }
    }

    /// Hidden entries count: Safari is a hidden link in /Applications.
    private static func installed() -> [Entry] {
        folders.flatMap { (try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)) ?? [] }
            .filter { $0.pathExtension == "app" }
            .compactMap { url in
                let info = NSDictionary(contentsOf: url.appendingPathComponent("Contents/Info.plist"))
                guard let id = info?["CFBundleIdentifier"] as? String else { return nil }
                return Entry(app: AppInfo(bundleId: id, name: name(url)), url: url)
            }
    }

    private static func name(_ url: URL) -> String {
        let name = FileManager.default.displayName(atPath: url.path)
        return name.hasSuffix(".app") ? String(name.dropLast(4)) : name
    }

    /// A 32 px PNG, the icon at 16 pt on a Retina screen.
    private static func icon(_ url: URL, side: Int = 32) -> String? {
        let image = NSWorkspace.shared.icon(forFile: url.path)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:]).map { "data:image/png;base64," + $0.base64EncodedString() }
    }
}
