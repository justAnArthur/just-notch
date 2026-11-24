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
            return GrantedResult(granted: await permissionState(try decode(PermissionParams.self, params).permission) == .allowed).json()

        case "permissions.request":
            return PermissionStateReply(state: await requestPermission(try decode(PermissionParams.self, params).permission)).json()

        case "onboarding.open":
            app.showOnboarding()
            return nil

        case "onboarding.finish":
            app.finishOnboarding()
            return nil

        case "permissions.state":
            return PermissionStateReply(state: await permissionState(try decode(PermissionParams.self, params).permission)).json()

        case "shortcuts.register":
            let id = try hotKeys.register(try decode(AcceleratorParams.self, params).accelerator, owner: ObjectIdentifier(webView))
            return IdResult(id: id).json()

        case "shortcuts.unregister":
            hotKeys.unregister(try decode(IdParams.self, params).id, owner: ObjectIdentifier(webView))
            return nil

        case "deepLinks.initial":
            return DeepLinkResult(url: app.takeInitialDeepLink()).json()

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
            if let answer = try await withoutAccessibility(method: method, params: params, service: service) { return answer }
            do {
                let result = try await service.handle(method: method, params: params)
                if method == "windows.setFrame" { Accessibility.reportSuccess() }
                return result
            } catch let error as ServiceError where error.message.hasPrefix(Self.accessibilityError) {
                // Trusted, yet macOS refused the call: a stale grant. The menu and Permissions show Needs reset.
                Accessibility.reportFailure()
                app.accessibilityChanged()
                AccessibilitySheet.explain(Self.accessibilityFeature(method), state: .broken)
                throw error
            }
        }
    }

    /// How WindowsService starts the error for a missing or stale grant.
    private static let accessibilityError = "Just Notch needs Accessibility"

    private static func accessibilityFeature(_ method: String) -> AccessibilitySheet.Feature {
        method.hasPrefix("windows.") ? .windows : method == "clipboard.paste" ? .paste : .overlay
    }

    /// The calls that need Accessibility, answered here while it isn't allowed, so a service's own system prompt
    /// never comes first: the sheet explains, then asks. A paste still copies the clip.
    private func withoutAccessibility(method: String, params: Data, service: NotchService) async throws -> Data? {
        switch method {
        case "windows.front", "windows.setFrame", "clipboard.paste":
            break
        case "hud.setEnabled" where (try? decode(EnabledFlag.self, params).enabled) == true:
            break
        default:
            return nil
        }
        let state = Accessibility.state()
        if state == .allowed { return nil }
        AccessibilitySheet.explain(Self.accessibilityFeature(method), state: state)
        app.accessibilityChanged()
        switch method {
        case "clipboard.paste":
            let id = try decode(ClipIdParams.self, params).id
            _ = try await service.handle(method: "clipboard.copy", params: try JSONEncoder().encode(ClipIdParams(id: id)))
            return try JSONSerialization.data(withJSONObject: ["pasted": false])
        case "hud.setEnabled":
            return try JSONSerialization.data(withJSONObject: ["enabled": false])
        default:
            throw ServiceError(state == .broken
                ? "Just Notch needs Accessibility to move windows: it's on in System Settings but needs a reset. Open Settings › Permissions and click Fix."
                : "Just Notch needs Accessibility to move windows: allow it in System Settings › Privacy & Security › Accessibility")
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

    /// Keeps the manager that asked for Bluetooth alive until the user answers.
    private var bluetoothAsk: CBCentralManager?

    /// Shows the system's prompt for one permission now (the onboarding card or Allow… explained it first),
    /// and returns the state after. Calendar and Location go through their services, which keep their stores.
    private func requestPermission(_ permission: String) async -> PermissionStateValue {
        switch permission {
        case "accessibility":
            Accessibility.prompt()
        case "calendar", "location":
            let method = permission == "calendar" ? "calendar.requestAccess" : "weather.requestAccess"
            if let service = services.first(where: { $0.methods.contains(method) }) {
                _ = try? await service.handle(method: method, params: Data("{}".utf8))
            }
        case "notifications":
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        case "bluetooth":
            if CBManager.authorization == .notDetermined { bluetoothAsk = CBCentralManager(delegate: nil, queue: nil) }
        case "automation":
            // Asking blocks until the user answers: off the main thread, one installed player at a time.
            let players = ["com.apple.Music", "com.spotify.client"].filter { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) != nil }
            await Task.detached {
                for player in players {
                    _ = AEDeterminePermissionToAutomateTarget(NSAppleEventDescriptor(bundleIdentifier: player).aeDesc, typeWildCard, typeWildCard, true)
                }
            }.value
        default:
            break
        }
        return await permissionState(permission)
    }

    /// What macOS says about a permission, without ever prompting.
    private func permissionState(_ permission: String) async -> PermissionStateValue {
        switch permission {
        case "accessibility":
            return switch Accessibility.state() {
            case .allowed: .allowed
            case .notAsked: .notAsked
            case .broken: .stale
            }
        case "calendar":
            return switch EKEventStore.authorizationStatus(for: .event) {
            case .fullAccess: .allowed
            case .notDetermined: .notAsked
            default: .off
            }
        case "bluetooth":
            return switch CBManager.authorization {
            case .allowedAlways: .allowed
            case .notDetermined: .notAsked
            default: .off
            }
        case "location":
            // Apple warns this one can stall the calling thread; the Welcome window asks every 2 s.
            guard await Task.detached(operation: { CLLocationManager.locationServicesEnabled() }).value else { return .off }
            return switch CLLocationManager().authorizationStatus {
            case .authorizedAlways, .authorized: .allowed
            case .notDetermined: .notAsked
            default: .off
            }
        case "automation":
            // It talks to each player, which can take seconds while one launches or hangs: never on the main thread.
            return await Task.detached(operation: Self.automationState).value
        case "notifications":
            return switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
            case .authorized, .provisional, .ephemeral: .allowed
            case .notDetermined: .notAsked
            default: .off
            }
        default:
            return .off
        }
    }

    /// The media players installed, each asked without a prompt: allowed if any is, off if one was refused.
    /// A player that isn't running can't answer (`procNotFound`), so it reads as not asked.
    nonisolated private static func automationState() -> PermissionStateValue {
        let players = ["com.apple.Music", "com.spotify.client"].filter {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) != nil
        }
        let answers = players.map {
            AEDeterminePermissionToAutomateTarget(NSAppleEventDescriptor(bundleIdentifier: $0).aeDesc, typeWildCard, typeWildCard, false)
        }
        if answers.contains(noErr) { return .allowed }
        if answers.contains(OSStatus(errAEEventNotPermitted)) { return .off }
        return .notAsked
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

/// `PermissionState`: `stale` is a grant System Settings shows but macOS no longer honours.
enum PermissionStateValue: String, Encodable {
    case allowed, notAsked, off, stale
}

/// `permissions.state`'s result.
struct PermissionStateReply: Encodable {
    var state: PermissionStateValue
}

/// Accessibility as macOS honours it, not as System Settings shows it. After an update re-signs the app the
/// toggle can stay on while `AXIsProcessTrusted()` says no, or say yes while every AX call fails: both are broken.
@MainActor
enum Accessibility {
    enum State { case allowed, notAsked, broken }

    /// Set once the app has been seen trusted, so losing it later reads as broken rather than never asked.
    private static let grantedKey = "permissions.accessibility.granted"
    /// A call failed with `.apiDisabled` while macOS said the app is trusted: the grant is stale until a move
    /// works again or the app is seen untrusted (the user removed it from the list to re-add it).
    private static var failed = false

    static func state() -> State {
        guard AXIsProcessTrusted() else {
            failed = false
            return UserDefaults.standard.bool(forKey: grantedKey) ? .broken : .notAsked
        }
        var value: CFTypeRef?
        // The answer comes from the app in front; a hung one would hold this (the main thread) for AX's 6 s default.
        let systemWide = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(systemWide, 0.25)
        let probe = AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute as CFString, &value)
        if probe == .apiDisabled || failed { return .broken }
        UserDefaults.standard.set(true, forKey: grantedKey)
        return .allowed
    }

    static func reportFailure() { failed = true }
    static func reportSuccess() { failed = false }

    /// macOS's own prompt, which offers to open System Settings.
    static func prompt() {
        AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    }
}

private struct EnabledFlag: Decodable {
    var enabled: Bool
}

private struct ClipIdParams: Codable {
    var id: String
}
