import Foundation

/// The app's folder in Application Support: `JustNotch` for the release app, `JustNotch Debug` for a Debug build
/// (a bundle id ending in `.debug`), so a Debug build never reads or rewrites the user's clipboard history, plugin
/// storage, shelf or caches.
public enum AppSupport {
    public static let folder = folder(bundleId: Bundle.main.bundleIdentifier)

    static func folder(bundleId: String?, base: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]) -> URL {
        base.appendingPathComponent(bundleId?.hasSuffix(".debug") == true ? "JustNotch Debug" : "JustNotch", isDirectory: true)
    }
}
