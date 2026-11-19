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

        allowFullFrameRate(configuration.preferences)

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

    /// WebKit caps page rendering near 60 fps; the island's motion runs at the display's rate (120 Hz on
    /// ProMotion), as the system's own animations do. A WebKit feature flag, set through its SPI when present.
    private static func allowFullFrameRate(_ preferences: WKPreferences) {
        let features = NSSelectorFromString("_features")
        let setEnabled = NSSelectorFromString("_setEnabled:forFeature:")
        guard (WKPreferences.self as AnyObject).responds(to: features), preferences.responds(to: setEnabled),
              let all = (WKPreferences.self as AnyObject).perform(features)?.takeUnretainedValue() as? [NSObject],
              let feature = all.first(where: { ($0.value(forKey: "key") as? String) == "PreferPageRenderingUpdatesNear60FPSEnabled" })
        else { return }
        // `perform` passes objects; a nil first argument is the BOOL NO.
        preferences.perform(setEnabled, with: nil, with: feature)
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
