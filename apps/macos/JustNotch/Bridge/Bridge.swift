import AppKit
import ApplicationServices
import CoreBluetooth
import EventKit
import NotchServices
import WebKit

/// JS → Swift: the `host` message handler. Checks permissions, answers host methods,
/// reference-counts topic subscriptions and routes the rest to the services.
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply, ServiceSink {
    private static let runtime = "runtime"
    private static let openSchemes: Set<String> = ["http", "https", "mailto"]

    unowned var app: AppDelegate!
    private let plugins: PluginStore
    private let storage = Storage()
    private let events: EventDispatcher
    private var services: [NotchService] = []
    /// Subscription counts per web view, so a reloaded page releases what its previous instance held.
    private var subscriptions: [ObjectIdentifier: [String: Int]] = [:]

    init(plugins: PluginStore, events: EventDispatcher) {
        self.plugins = plugins
        self.events = events
        super.init()
    }

    func startServices() {
        services = ServiceRegistry.makeAll()
        for service in services { service.sink = self }
    }

    // MARK: ServiceSink

    func publish(topic: String, value: Data) {
        let payload = #"{"topic":"\#(topic)","value":\#(String(decoding: value, as: UTF8.self))}"#
        events.send("topic", payload: Data(payload.utf8), key: "topic:\(topic)", to: app.webViews)
    }

    func emit(event: String, payload: Data) {
        events.send(event, payload: payload, to: app.webViews)
    }

    // MARK: requests

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let webView = message.webView,
              let body = message.body as? [String: Any],
              let plugin = body["plugin"] as? String,
              let method = body["method"] as? String,
              let params = try? JSONSerialization.data(withJSONObject: body["params"] ?? [String: Any](), options: .fragmentsAllowed)
        else {
            replyHandler(nil, "malformed host request")
            return
        }
        Task {
            do {
                let result = try await handle(plugin: plugin, method: method, params: params, from: webView)
                replyHandler(try result.map { try JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed) } ?? NSNull(), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private func handle(plugin: String, method: String, params: Data, from webView: WKWebView) async throws -> Data? {
        try authorize(plugin: plugin, method: method, params: params, from: webView)

        switch method {
        case "host.ready":
            release(webView)
            return hostInfo(for: webView).json()

        case "host.log":
            let p = try decode(LogParams.self, params)
            hostLog(level: p.level, "[\(plugin)] \(p.message)")
            return nil

        case "window.setHitRegions":
            app.panel(for: webView)?.setHitRegions(try decode(HitRegionsParams.self, params).rects)
            return nil

        case "window.setFocusable":
            app.panel(for: webView)?.panel.focusable = try decode(FocusableParams.self, params).focusable
            return nil

        case "window.openSettings":
            app.openSettings()
            return nil

        case "subscribe":
            return try await subscribe(try decode(TopicParams.self, params).topic, from: webView)

        case "unsubscribe":
            unsubscribe(try decode(TopicParams.self, params).topic, from: webView)
            return nil

        case "storage.get":
            return try storage.get(plugin: plugin, key: try decode(KeyParams.self, params).key)

        case "storage.set":
            let object = try JSONSerialization.jsonObject(with: params) as? [String: Any] ?? [:]
            guard let key = object["key"] as? String else { throw ServiceError("storage.set needs a key") }
            try storage.set(plugin: plugin, key: key, value: object["value"] ?? NSNull())
            return nil

        case "system.openUrl":
            let raw = try decode(UrlParams.self, params).url
            guard let url = URL(string: raw), Self.openSchemes.contains(url.scheme?.lowercased() ?? "") else {
                throw ServiceError("system.openUrl allows http, https and mailto only")
            }
            NSWorkspace.shared.open(url)
            return nil

        case "permissions.status":
            return GrantedResult(granted: permissionGranted(try decode(PermissionParams.self, params).permission)).json()

        case "plugins.setEnabled":
            let p = try decode(SetEnabledParams.self, params)
            guard plugins.manifest(p.id) != nil else { throw ServiceError("unknown plugin \(p.id)") }
            plugins.setEnabled(p.id, p.enabled)
            return nil

        case "files.beginDrag":
            guard let panel = app.panel(for: webView) else { throw ServiceError("files.beginDrag works from the island only") }
            try await panel.beginDrag(paths: try decode(PathsParams.self, params).paths)
            return nil

        default:
            guard let service = services.first(where: { $0.methods.contains(method) }) else {
                throw ServiceError("unknown method \(method)")
            }
            return try await service.handle(method: method, params: params)
        }
    }

    /// The runtime and the settings page are trusted; a plugin needs its manifest's permissions.
    private func authorize(plugin: String, method: String, params: Data, from webView: WKWebView) throws {
        if plugin == Self.runtime || webView === app.settingsWebView { return }
        guard let manifest = plugins.manifest(plugin) else { throw ServiceError("unknown plugin \(plugin)") }
        if Schema.runtimeOnly.contains(method) { throw ServiceError("\(method) is reserved for the runtime") }

        if let permission = Schema.methodPermission[method], !manifest.permissions.contains(permission) {
            throw ServiceError("\(plugin) needs the \(permission.rawValue) permission for \(method)")
        }

        if method == "subscribe" || method == "unsubscribe" {
            let topic = try decode(TopicParams.self, params).topic
            guard let permission = Schema.topicPermission[topic] else { throw ServiceError("unknown topic \(topic)") }
            guard manifest.permissions.contains(permission) else {
                throw ServiceError("\(plugin) needs the \(permission.rawValue) permission for \(topic)")
            }
        }
    }

    // MARK: subscriptions

    private func subscribe(_ topic: String, from webView: WKWebView) async throws -> Data? {
        guard Schema.topicPermission[topic] != nil else { throw ServiceError("unknown topic \(topic)") }
        guard let service = service(for: topic) else { throw ServiceError("no service publishes \(topic)") }
        let first = total(topic) == 0
        subscriptions[ObjectIdentifier(webView), default: [:]][topic, default: 0] += 1
        if first { service.start(topic: topic) }
        return await service.snapshot(topic: topic)
    }

    private func unsubscribe(_ topic: String, from webView: WKWebView) {
        let id = ObjectIdentifier(webView)
        guard let count = subscriptions[id]?[topic], count > 0 else { return }
        subscriptions[id]?[topic] = count == 1 ? nil : count - 1
        if total(topic) == 0 { service(for: topic)?.stop(topic: topic) }
    }

    /// Drops every subscription a web view holds (page reload, crash, panel closed).
    func release(_ webView: WKWebView) {
        guard let held = subscriptions.removeValue(forKey: ObjectIdentifier(webView)) else { return }
        for topic in held.keys where total(topic) == 0 {
            service(for: topic)?.stop(topic: topic)
        }
    }

    private func total(_ topic: String) -> Int {
        subscriptions.values.reduce(0) { $0 + ($1[topic] ?? 0) }
    }

    private func service(for topic: String) -> NotchService? {
        services.first { $0.topics.contains(topic) }
    }

    // MARK: helpers

    private func hostInfo(for webView: WKWebView) -> HostInfo {
        HostInfo(
            version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
            devMode: app.devServer != nil,
            devServerUrl: app.devServer?.absoluteString,
            plugins: plugins.plugins,
            geometry: app.geometry(for: webView)
        )
    }

    private func permissionGranted(_ permission: String) -> Bool {
        switch permission {
        case "accessibility":
            return AXIsProcessTrusted()
        case "calendar":
            return EKEventStore.authorizationStatus(for: .event) == .fullAccess
        case "bluetooth":
            return CBManager.authorization == .allowedAlways
        case "automation":
            // Music is the usual automation target (media control); there is no app-independent check.
            let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.Music")
            return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, false) == noErr
        default:
            return false
        }
    }

    private func hostLog(level: String, _ message: String) {
        switch level {
        case "error": log.error("\(message, privacy: .public)")
        case "warn": log.warning("\(message, privacy: .public)")
        case "debug": log.debug("\(message, privacy: .public)")
        default: log.info("\(message, privacy: .public)")
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw ServiceError("invalid params: \(error.localizedDescription)")
        }
    }
}
