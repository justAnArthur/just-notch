import AppKit
import QuickLookThumbnailing

/// `files.thumbnail`, `files.airdrop`, `files.reveal`, `files.open`, `files.copy`, `files.trash`.
@MainActor
public final class FilesService: NotchService {
    public let methods = ["files.thumbnail", "files.airdrop", "files.reveal", "files.open", "files.copy", "files.trash"]
    public weak var sink: ServiceSink?

    public init() {}

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "files.thumbnail":
            let request = try decode(ThumbnailParams.self, params)
            return URLResult(url: try await thumbnail(path: request.path, size: request.size)).json()
        case "files.airdrop":
            try airdrop(try decode(PathsParams.self, params).paths.map(existing))
            return nil
        case "files.reveal":
            NSWorkspace.shared.activateFileViewerSelecting([try existing(try decode(PathParams.self, params).path)])
            return nil
        case "files.open":
            let request = try decode(OpenParams.self, params)
            let url = try existing(request.path)
            if let app = request.app {
                let configuration = NSWorkspace.OpenConfiguration()
                _ = try await NSWorkspace.shared.open([url], withApplicationAt: try Self.application(app), configuration: configuration)
            } else {
                guard NSWorkspace.shared.open(url) else { throw ServiceError("no app opens this file") }
            }
            return nil
        case "files.copy":
            let urls = try decode(PathsParams.self, params).paths.map(existing)
            NSPasteboard.general.clearContents()
            guard NSPasteboard.general.writeObjects(urls as [NSURL]) else { throw ServiceError("couldn't copy the files") }
            return nil
        case "files.trash":
            try FileManager.default.trashItem(at: try existing(try decode(PathParams.self, params).path), resultingItemURL: nil)
            return nil
        default:
            throw ServiceError("unknown method \(method)")
        }
    }

    /// An app by path, bundle id or name (`Visual Studio Code`), looked up in the usual Applications folders.
    static func application(_ app: String) throws -> URL {
        let manager = FileManager.default
        if app.hasPrefix("/") || app.hasPrefix("~") {
            let url = URL(fileURLWithPath: (app as NSString).expandingTildeInPath)
            if manager.fileExists(atPath: url.path) { return url }
        }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: app) { return url }
        let name = app.hasSuffix(".app") ? app : app + ".app"
        let home = manager.homeDirectoryForCurrentUser.path
        for folder in ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", home + "/Applications"] {
            let url = URL(fileURLWithPath: folder).appendingPathComponent(name)
            if manager.fileExists(atPath: url.path) { return url }
        }
        throw ServiceError("no app named \(app)")
    }

    private func existing(_ path: String) throws -> URL {
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        guard FileManager.default.fileExists(atPath: url.path) else { throw ServiceError("no file at \(path)") }
        return url
    }

    private func thumbnail(path: String, size: Double) async throws -> String {
        let url = try existing(path)
        let side = min(max(size, 16), 1024)
        let scale = NSScreen.main?.backingScaleFactor ?? 2
        let request = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: side, height: side), scale: scale, representationTypes: .all)
        let representation = try await QLThumbnailGenerator.shared.generateBestRepresentation(for: request)
        guard let png = NSBitmapImageRep(cgImage: representation.cgImage).representation(using: .png, properties: [:]) else {
            throw ServiceError("thumbnail encoding failed")
        }
        return "data:image/png;base64," + png.base64EncodedString()
    }

    private func airdrop(_ urls: [URL]) throws {
        guard let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: urls) else {
            throw ServiceError("AirDrop is unavailable")
        }
        service.perform(withItems: urls)
    }
}
