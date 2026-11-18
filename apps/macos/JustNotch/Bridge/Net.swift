import Foundation
import NotchServices

/// Which hosts each plugin may reach: its manifest's `hosts` plus the exact hosts the user granted
/// (UserDefaults `plugins.hosts`, `[id: [host]]`).
@MainActor
final class NetAccess {
    private static let grantsKey = "plugins.hosts"

    private let plugins: PluginStore
    private var pending: Set<String> = []
    /// `plugin host` pairs refused this session: asking again doesn't prompt.
    private var denied: Set<String> = []

    init(plugins: PluginStore) {
        self.plugins = plugins
    }

    func manifestHosts(_ plugin: String) -> [String] {
        plugins.manifest(plugin)?.hosts ?? []
    }

    func granted(_ plugin: String) -> [String] {
        grants()[plugin] ?? []
    }

    func allowed(_ plugin: String) -> [String] {
        manifestHosts(plugin) + granted(plugin)
    }

    func revoke(plugin: String, host: String) {
        var grants = grants()
        grants[plugin]?.removeAll { $0 == host }
        if grants[plugin]?.isEmpty == true { grants[plugin] = nil }
        UserDefaults.standard.set(grants, forKey: Self.grantsKey)
    }

    /// Uninstalling with its data: every grant, and the session's denials.
    func revokeAll(plugin: String) {
        var grants = grants()
        grants[plugin] = nil
        UserDefaults.standard.set(grants, forKey: Self.grantsKey)
        denied = denied.filter { !$0.hasPrefix("\(plugin) ") }
    }

    func requestHost(plugin: String, url raw: String, reason: String?) throws -> Bool {
        guard let url = URL(string: raw), let host = HostPattern.key(url), !host.contains("*") else {
            throw ServiceError("net.requestHost needs an absolute URL")
        }
        guard HostPattern.schemeAllowed(url) else { throw ServiceError("net.requestHost needs https (http only for local hosts)") }
        if HostPattern.allowed(allowed(plugin), url: url) { return true }
        if denied.contains("\(plugin) \(host)") { return false }
        guard pending.insert(plugin).inserted else { throw ServiceError("\(plugin) is already asking for a host") }
        defer { pending.remove(plugin) }

        let name = plugins.manifest(plugin)?.name ?? plugin
        guard Consent.host(name: name, host: host, reason: reason) else {
            denied.insert("\(plugin) \(host)")
            return false
        }
        var grants = grants()
        grants[plugin, default: []].append(host)
        UserDefaults.standard.set(grants, forKey: Self.grantsKey)
        return true
    }

    private func grants() -> [String: [String]] {
        UserDefaults.standard.dictionary(forKey: Self.grantsKey) as? [String: [String]] ?? [:]
    }
}
