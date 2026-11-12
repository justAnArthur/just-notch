import Foundation
import NotchServices
import WebKit

/// Swift → JS: queues `HostEvent`s per web view and flushes them as one
/// `window.__notch.dispatch([...])` call at most once per frame.
@MainActor
final class EventDispatcher {
    private struct Pending {
        weak var webView: WKWebView?
        var events: [(key: String?, json: String)] = []
    }

    private static let frame: TimeInterval = 1.0 / 60
    private var pending: [ObjectIdentifier: Pending] = [:]
    private var scheduled = false

    /// Events with the same `key` replace each other within a frame (latest value wins).
    func send(_ type: String, payload: Data, key: String? = nil, to webViews: [WKWebView]) {
        let json = #"{"type":"\#(type)","payload":\#(String(decoding: payload, as: UTF8.self))}"#
        for webView in webViews {
            let id = ObjectIdentifier(webView)
            var queue = pending[id] ?? Pending(webView: webView)
            if let key, let index = queue.events.firstIndex(where: { $0.key == key }) {
                queue.events[index].json = json
            } else {
                queue.events.append((key, json))
            }
            pending[id] = queue
        }
        schedule()
    }

    func send<T: Encodable>(_ type: String, _ payload: T, key: String? = nil, to webViews: [WKWebView]) {
        guard let data = payload.json() else { return }
        send(type, payload: data, key: key, to: webViews)
    }

    private func schedule() {
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.frame) { [weak self] in
            MainActor.assumeIsolated { self?.flush() }
        }
    }

    private func flush() {
        scheduled = false
        let queues = pending
        pending = [:]
        for queue in queues.values {
            guard let webView = queue.webView, !queue.events.isEmpty else { continue }
            let array = "[" + queue.events.map(\.json).joined(separator: ",") + "]"
            webView.evaluateJavaScript("window.__notch && window.__notch.dispatch(\(array))", completionHandler: nil)
        }
    }
}
