import Foundation

/// Mirror of bridge-schema's `validHostPattern` / `hostAllowed` / `isLocalHost` / `netSchemeAllowed`;
/// both run packages/bridge-schema/test/host-cases.json.
public enum HostPattern {
    private static let label = try! NSRegularExpression(pattern: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
    private static let port = try! NSRegularExpression(pattern: #"^[1-9]\d{0,4}$"#)
    private static let ipv4 = try! NSRegularExpression(pattern: #"^\d{1,3}(\.\d{1,3}){3}$"#)

    /// `host`, `host:port` or `*.domain.tld[:port]`, lowercase; a wildcard needs two labels after `*.`.
    public static func isValid(_ pattern: String) -> Bool {
        let parts = pattern.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count <= 2 else { return false }
        if parts.count == 2 {
            guard matches(port, parts[1]), let value = Int(parts[1]), value <= 65_535 else { return false }
        }
        let host = parts[0]
        let wildcard = host.hasPrefix("*.")
        let labels = (wildcard ? String(host.dropFirst(2)) : host).split(separator: ".", omittingEmptySubsequences: false)
        if wildcard && labels.count < 2 { return false }
        return labels.allSatisfy { matches(label, String($0)) }
    }

    /// Whether `url`'s host matches one of `patterns`; a pattern without a port matches any port.
    public static func allowed(_ patterns: [String], url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        let scheme = url.scheme?.lowercased()
        let urlPort = url.port.map(String.init) ?? (scheme == "https" ? "443" : scheme == "http" ? "80" : "")
        return patterns.contains { pattern in
            guard isValid(pattern) else { return false }
            let parts = pattern.split(separator: ":").map(String.init)
            if parts.count == 2, parts[1] != urlPort { return false }
            let patternHost = parts[0]
            return patternHost.hasPrefix("*.") ? host.hasSuffix(String(patternHost.dropFirst())) : host == patternHost
        }
    }

    /// localhost, `*.localhost`, `*.local`, loopback and private IPv4, IPv6 loopback and unique-local.
    public static func isLocal(_ hostname: String) -> Bool {
        var host = hostname.lowercased()
        if host.hasPrefix("["), host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") { return true }
        if host == "::1" || host.range(of: "^f[cd][0-9a-f]{2}:", options: .regularExpression) != nil { return true }
        guard matches(ipv4, host) else { return false }
        let ip = host.split(separator: ".").compactMap { Int($0) }
        let (a, b) = (ip[0], ip[1])
        return a == 127 || a == 10 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168)
    }

    /// `https`, or `http` to a local host.
    public static func schemeAllowed(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "https": return true
        case "http": return url.host.map(isLocal) ?? false
        default: return false
        }
    }

    /// The `host[:port]` a grant is stored under: lowercased, default ports left out.
    public static func key(_ url: URL) -> String? {
        guard let host = url.host?.lowercased() else { return nil }
        let display = host.contains(":") ? "[\(host)]" : host
        let scheme = url.scheme?.lowercased()
        guard let port = url.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) else { return display }
        return "\(display):\(port)"
    }

    private static func matches(_ regex: NSRegularExpression, _ string: String) -> Bool {
        regex.firstMatch(in: string, range: NSRange(string.startIndex..., in: string)) != nil
    }
}
