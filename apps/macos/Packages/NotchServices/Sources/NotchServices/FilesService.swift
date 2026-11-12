import AppKit
import QuickLookThumbnailing

/// `files.thumbnail`, `files.airdrop`, `files.reveal`, `files.open`.
@MainActor
public final class FilesService: NotchService {
    public let methods = ["files.thumbnail", "files.airdrop", "files.reveal", "files.open"]
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
            guard NSWorkspace.shared.open(try existing(try decode(PathParams.self, params).path)) else { throw ServiceError("no app opens this file") }
            return nil
        default:
            throw ServiceError("unknown method \(method)")
        }
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
