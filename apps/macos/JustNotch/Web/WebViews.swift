import AppKit
import WebKit

@MainActor
enum WebViews {
    /// A transparent web view wired to the bridge and the `notch:` scheme.
    static func make<V: WKWebView>(_ type: V.Type, frame: NSRect, bridge: Bridge, scheme: SchemeHandler, lifecycle: WebLifecycle) -> V {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(scheme, forURLScheme: SchemeHandler.scheme)
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "host")
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = V(frame: frame, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear
        webView.navigationDelegate = lifecycle
        webView.autoresizingMask = [.width, .height]
        #if DEBUG
        webView.isInspectable = true
        #endif
        return webView
    }

    static func load(_ webView: WKWebView, page: String, devServer: URL?) {
        let origin = devServer?.absoluteString ?? SchemeHandler.origin
        webView.load(URLRequest(url: URL(string: origin + "/" + page)!))
    }
}

/// Reloads crashed web content and keeps navigation on the app's own origin.
@MainActor
final class WebLifecycle: NSObject, WKNavigationDelegate {
    private let origin: String
    var onTerminate: ((WKWebView) -> Void)?

    init(origin: String) {
        self.origin = origin
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log.error("web content process terminated, reloading")
        onTerminate?(webView)
        webView.reload()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .allow }
        if let frame = action.targetFrame, !frame.isMainFrame { return .allow }
        if url.absoluteString.hasPrefix(origin) || url.scheme == "about" { return .allow }
        if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return .cancel
    }
}
