import AppKit
import ApplicationServices
import CoreBluetooth
import CoreLocation
import EventKit
import NotchServices
import UserNotifications
import WebKit

/// JS → Swift: the `host` message handler. Checks permissions, answers host methods,
/// reference-counts topic subscriptions and routes the rest to the services.
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply, ServiceSink {
    private static let runtime = "runtime"
    /// `x-apple.systempreferences` lets a plugin send the user to the pane that grants what it needs.
    private static let openSchemes: Set<String> = ["http", "https", "mailto", "x-apple.systempreferences"]

    unowned var app: AppDelegate!
    private let plugins: PluginStore
    private let storage = Storage()
    private let events: EventDispatcher
    private var services: [NotchService] = []
    /// Subscription counts per web view, so a reloaded page releases what its previous instance held.
    private var subscriptions: [ObjectIdentifier: [String: Int]] = [:]
    private let hotKeys = HotKeys()
    private let net: NetAccess
    private let proxy = HTTPProxy(version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0")
    private let secrets = SecretsStore()
    private let library: LibraryStore
    /// `net.fetch`es in flight per web view, cancelled when the page goes away.
    private var fetches: [ObjectIdentifier: [UUID: Task<NetResponse, Error>]] = [:]

    init(plugins: PluginStore, events: EventDispatcher) {
        self.plugins = plugins
        self.events = events
        net = NetAccess(plugins: plugins)
        library = LibraryStore(plugins: plugins, storage: storage, secrets: secrets, net: net,
                               version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0")
        super.init()
        // Keyed by phase too: a frame keeps each step, only a phase's own updates replace each other.
        library.onProgress = { [weak self] progress in
            guard let self else { return }
            events.send("library.progress", progress, key: "library.progress:\(progress.id):\(progress.phase.rawValue)", to: app.webViews)
        }
    }

    func startServices() {
        services = ServiceRegistry.makeAll()
        for service in services { service.sink = self }
        hotKeys.onPress = { [weak self] id, owner in
            guard let self, let webView = app.webViews.first(where: { ObjectIdentifier($0) == owner }),
                  let payload = try? JSONSerialization.data(withJSONObject: ["id": id]) else { return }
            events.send("shortcut", payload: payload, to: [webView])
        }
    }

    /// The host's own global shortcut (the launcher's), outside any page's.
    func registerHostShortcut(_ accelerator: String, action: @escaping () -> Void) throws -> String {
        try hotKeys.register(accelerator, action: action)
    }

    func unregisterHostShortcut(_ id: String) {
        hotKeys.unregister(id, owner: ObjectIdentifier(HotKeys.self))
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
            app.pageReady()
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

        case "launcher.closed":
            app.launcher.closed()
            return nil

        case "window.openSettings":
            app.openSettings()
            return nil

        case "window.endGesture":
            app.panel(for: webView)?.webView.endGesture()
            return nil

        case "window.haptic":
            let pattern: NSHapticFeedbackManager.FeedbackPattern = switch try decode(HapticParams.self, params).pattern {
            case .alignment: .alignment
            case .levelChange: .levelChange
            case .generic: .generic
            }
            NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .now)
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
            let value = object["value"] ?? NSNull()
            try storage.set(plugin: plugin, key: key, value: value)
            let changed = try JSONSerialization.data(withJSONObject: ["plugin": plugin, "key": key, "value": value])
            events.send("storage.changed", payload: changed, key: "storage.changed:\(plugin)/\(key)", to: app.webViews)
            return nil

        case "net.fetch":
            return try await fetch(try NetRequest(json: params), plugin: plugin, from: webView).json()

        case "net.requestHost":
            let p = try decode(RequestHostParams.self, params)
            return GrantedResult(granted: try net.requestHost(plugin: plugin, url: p.url, reason: p.reason)).json()

        case "net.hosts":
            return HostsResult(manifest: net.manifestHosts(plugin), granted: net.granted(plugin)).json()

        case "net.revokeHost":
            let p = try decode(RevokeHostParams.self, params)
            net.revoke(plugin: p.plugin, host: p.host)
            return nil

        case "secrets.get":
            return SecretResult(value: try await secrets.get(plugin: plugin, key: try decode(KeyParams.self, params).key)).json()

        case "secrets.set":
            let p = try decode(SecretSetParams.self, params)
            try await secrets.set(plugin: plugin, key: p.key, value: p.value)
            secretChanged(plugin: plugin, key: p.key)
            return nil

        case "secrets.delete":
            let key = try decode(KeyParams.self, params).key
            try await secrets.delete(plugin: plugin, key: key)
            secretChanged(plugin: plugin, key: key)
            return nil

        case "system.openUrl":
            let raw = try decode(UrlParams.self, params).url
            guard let url = URL(string: raw), Self.openSchemes.contains(url.scheme?.lowercased() ?? "") else {
                throw ServiceError("system.openUrl allows http, https, mailto and x-apple.systempreferences only")
            }
            NSWorkspace.shared.open(url)
            return nil

        case "permissions.status":
            return GrantedResult(granted: await permissionGranted(try decode(PermissionParams.self, params).permission)).json()

        case "shortcuts.register":
            let id = try hotKeys.register(try decode(AcceleratorParams.self, params).accelerator, owner: ObjectIdentifier(webView))
            return IdResult(id: id).json()

        case "shortcuts.unregister":
            hotKeys.unregister(try decode(IdParams.self, params).id, owner: ObjectIdentifier(webView))
            return nil

        case "deepLinks.initial":
            return DeepLinkResult(url: app.initialDeepLink).json()

        case "updater.check":
            return await app.updater.check().json()

        case "updater.install":
            app.updater.install()
            return nil

        case "updater.preferences":
            return app.updater.preferences.json()

        case "updater.setPreferences":
            let p = try decode(UpdaterPreferencesParams.self, params)
            if let checks = p.automaticChecks { app.updater.automaticChecks = checks }
            if let downloads = p.automaticDownloads { app.updater.automaticDownloads = downloads }
            return app.updater.preferences.json()

        case "plugins.setEnabled":
            let p = try decode(SetEnabledParams.self, params)
            guard plugins.manifest(p.id) != nil else { throw ServiceError("unknown plugin \(p.id)") }
            plugins.setEnabled(p.id, p.enabled)
            return nil

        case "library.catalog":
            return try await library.catalog(refresh: try decode(RefreshParams.self, params).refresh ?? false).json()

        case "library.install":
            return try await library.install(try decode(IdParams.self, params).id).json()

        case "library.uninstall":
            try await library.uninstall(try decode(IdParams.self, params).id)
            return nil

        case "app.preferences":
            return app.preferences.json()

        case "app.setPreferences":
            try app.setPreferences(try decode(PreferencesParams.self, params))
            return app.preferences.json()

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

    /// The runtime (which renders the settings page too) is trusted; a plugin needs its manifest's permissions.
    private func authorize(plugin: String, method: String, params: Data, from webView: WKWebView) throws {
        if plugin == Self.runtime {
            // `runtime` skips every check, so it must not reach a plugin's hosts or Keychain entries.
            if Schema.pluginOnly.contains(method) { throw ServiceError("\(method) is for plugins only") }
            return
        }
        guard let manifest = plugins.manifest(plugin) else { throw ServiceError("unknown plugin \(plugin)") }
        if let reason = plugins.incompatible(plugin) { throw ServiceError(reason) }
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

    // MARK: net and secrets

    private func fetch(_ request: NetRequest, plugin: String, from webView: WKWebView) async throws -> NetResponse {
        let patterns = net.allowed(plugin)
        let page = ObjectIdentifier(webView), id = UUID()
        let task = Task { [proxy] in
            try await proxy.fetch(request, plugin: plugin) { HostPattern.allowed(patterns, url: $0) }
        }
        fetches[page, default: [:]][id] = task
        defer { fetches[page]?[id] = nil }
        return try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
    }

    /// Never carries the value: a page that wants it asks with `secrets.get`.
    private func secretChanged(plugin: String, key: String) {
        events.send("secrets.changed", SecretsChangedPayload(plugin: plugin, key: key), key: "secrets.changed:\(plugin)/\(key)", to: app.webViews)
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
        hotKeys.release(owner: ObjectIdentifier(webView))
        fetches.removeValue(forKey: ObjectIdentifier(webView))?.values.forEach { $0.cancel() }
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
            apiVersion: Semver.apiVersion,
            devMode: app.devServer != nil,
            devServerUrl: app.devServer?.absoluteString,
            plugins: plugins.plugins,
            geometry: app.geometry(for: webView)
        )
    }

    private func permissionGranted(_ permission: String) async -> Bool {
        switch permission {
        case "accessibility":
            return Accessibility.state() == .allowed
        case "calendar":
            return EKEventStore.authorizationStatus(for: .event) == .fullAccess
        case "bluetooth":
            return CBManager.authorization == .allowedAlways
        case "location":
            return [.authorizedAlways, .authorized].contains(CLLocationManager().authorizationStatus)
        case "automation":
            // Music is the usual automation target (media control); there is no app-independent check.
            let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.Music")
            return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, false) == noErr
        case "notifications":
            return [.authorized, .provisional].contains(await UNUserNotificationCenter.current().notificationSettings().authorizationStatus)
        default:
            return false
        }
    }

    private func hostLog(level: String, _ message: String) {
        #if DEBUG
        DebugProbe.append(log: "\(level) \(message)")
        #endif
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

/// Accessibility as macOS honours it, not as System Settings shows it. After an update re-signs the app the
/// toggle can stay on while `AXIsProcessTrusted()` says no, or say yes while every AX call fails: both are broken.
enum Accessibility {
    enum State { case allowed, notAsked, broken }

    /// Set once the app has been seen trusted, so losing it later reads as broken rather than never asked.
    private static let grantedKey = "permissions.accessibility.granted"

    static func state() -> State {
        guard AXIsProcessTrusted() else {
            return UserDefaults.standard.bool(forKey: grantedKey) ? .broken : .notAsked
        }
        var value: CFTypeRef?
        let probe = AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as CFString, &value)
        if probe == .apiDisabled { return .broken }
        UserDefaults.standard.set(true, forKey: grantedKey)
        return .allowed
    }
}
