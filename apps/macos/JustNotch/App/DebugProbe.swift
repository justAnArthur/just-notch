#if DEBUG
import AppKit
import WebKit

/// Debug builds only: lets a script inspect the live island without the Web Inspector.
///
/// Drop `<name>.cmd.json` (`{"js": "...", "snapshot": true}`) into `~/Library/Application Support/JustNotch/Debug/`.
/// The probe runs `js` as an async function body in the first panel's web view, writes `{result}` or `{error}` to
/// `<name>.result.json`, saves the web view as `<name>.png` when asked, then deletes the command. Several clients can
/// probe at once under different names. Every `host.log` line is also appended to `web.log` there.
@MainActor
final class DebugProbe {
    static let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("JustNotch/Debug", isDirectory: true)

    private var timer: Timer?
    private let webView: () -> WKWebView?

    init(webView: @escaping () -> WKWebView?) {
        self.webView = webView
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    static func append(log line: String) {
        let url = folder.appendingPathComponent("web.log")
        let data = Data("\(Date().ISO8601Format()) \(line)\n".utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }

    private struct Command: Decodable {
        var js: String?
        var snapshot: Bool?
    }

    private func poll() {
        let files = (try? FileManager.default.contentsOfDirectory(at: Self.folder, includingPropertiesForKeys: nil)) ?? []
        for url in files where url.lastPathComponent.hasSuffix(".cmd.json") {
            let name = String(url.lastPathComponent.dropLast(".cmd.json".count))
            guard let data = try? Data(contentsOf: url) else { continue }
            try? FileManager.default.removeItem(at: url)
            guard let command = try? JSONDecoder().decode(Command.self, from: data), let webView = webView() else { continue }
            Task { await run(command, name: name, in: webView) }
        }
    }

    private func run(_ command: Command, name: String, in webView: WKWebView) async {
        var output: [String: Any] = [:]
        if let js = command.js {
            do {
                let value = try await webView.callAsyncJavaScript(
                    "return JSON.stringify(await (async () => { \(js) })())", contentWorld: .page)
                output["result"] = value
            } catch {
                output["error"] = "\(error)"
            }
        }
        if command.snapshot == true {
            let configuration = WKSnapshotConfiguration()
            configuration.afterScreenUpdates = true
            if let image = try? await webView.takeSnapshot(configuration: configuration),
               let tiff = image.tiffRepresentation,
               let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                try? png.write(to: Self.folder.appendingPathComponent("\(name).png"))
                output["snapshot"] = "\(name).png"
            }
        }
        let json = (try? JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted])) ?? Data()
        try? json.write(to: Self.folder.appendingPathComponent("\(name).result.json"))
    }
}
#endif
