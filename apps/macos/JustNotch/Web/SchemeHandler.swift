import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves `notch://app/...` from Resources/Web; `plugins/<id>/...` falls back to the user plugin folder.
@MainActor
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "notch"
    static let origin = "notch://app"

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "map": "application/json; charset=utf-8",
        "txt": "text/plain; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "avif": "image/avif",
        "ico": "image/x-icon",
        "wasm": "application/wasm",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
        "otf": "font/otf",
    ]

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        guard let file = resolve(url), let data = try? Data(contentsOf: file) else {
            respond(task, url: url, status: 404, mime: "text/plain; charset=utf-8", data: Data("not found: \(url.path)".utf8))
            return
        }
        respond(task, url: url, status: 200, mime: Self.mime(file), data: data)
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

    private func respond(_ task: any WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data) {
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func resolve(_ url: URL) -> URL? {
        guard url.host == "app" else { return nil }
        var parts = url.path.split(separator: "/").map(String.init)
        guard !parts.contains(where: { $0 == ".." || $0 == "." }) else { return nil }
        if url.path.isEmpty || url.path.hasSuffix("/") { parts.append("index.html") }

        let candidates: [URL]
        if parts.first == "plugins", parts.count > 2 {
            let rest = parts.dropFirst(2).joined(separator: "/")
            candidates = [Paths.builtInPlugins, Paths.userPlugins].map { $0.appendingPathComponent(parts[1]).appendingPathComponent(rest) }
        } else {
            candidates = [Paths.web.appendingPathComponent(parts.joined(separator: "/"))]
        }
        return candidates.first { file in
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory) && !isDirectory.boolValue
        }
    }

    private static func mime(_ file: URL) -> String {
        let ext = file.pathExtension.lowercased()
        return mimeTypes[ext] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
}
