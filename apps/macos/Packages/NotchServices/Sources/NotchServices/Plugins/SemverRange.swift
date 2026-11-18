import Foundation

/// Mirror of bridge-schema's `API_VERSION`, `compareVersions` and `satisfies`: the node-semver subset
/// `engines.notch` is checked with. Both run packages/bridge-schema/test/semver-cases.json.
public enum Semver {
    /// What plugins are written against; keep equal to bridge-schema's `API_VERSION`.
    public static let apiVersion = "1.1.0"

    struct Version {
        var major: Int
        var minor: Int
        var patch: Int
        var pre: [String] = []
    }

    enum Op { case lt, le, gt, ge, eq }

    struct Comparator {
        var op: Op
        var version: Version
    }

    private static let ident = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*"
    private static let versionPattern = try! NSRegularExpression(
        pattern: "^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(\(ident)))?(?:\\+\(ident))?$")
    private static let partialPattern = try! NSRegularExpression(
        pattern: "^v?(\\d+|[xX*])(?:\\.(\\d+|[xX*]))?(?:\\.(\\d+|[xX*]))?(?:-(\(ident)))?(?:\\+\(ident))?$")
    private static let hyphenPattern = try! NSRegularExpression(pattern: "^(\\S+)\\s+-\\s+(\\S+)$")
    private static let spacedOperator = try! NSRegularExpression(pattern: "(<=|>=|<|>|=|\\^|~)\\s+")
    /// `-0`, the lowest prerelease: `<2.0.0-0` keeps out 2.0.0's prereleases.
    private static let low = ["0"]

    /// -1, 0 or 1 by semver precedence (build metadata ignored); a malformed version sorts before every valid one.
    public static func compare(_ a: String, _ b: String) -> Int {
        switch (parse(a), parse(b)) {
        case let (x?, y?): return compare(x, y)
        case (_?, nil): return 1
        case (nil, _?): return -1
        case (nil, nil): return 0
        }
    }

    /// Whether `version` is in `range`; false when either doesn't parse.
    public static func satisfies(_ version: String, _ range: String) -> Bool {
        guard let v = parse(version) else { return false }
        var sets: [[Comparator]?] = []
        for set in range.components(separatedBy: "||") {
            guard let parsed = parseSet(set.trimmingCharacters(in: .whitespaces)) else { return false }
            sets.append(parsed)
        }
        return sets.contains { set in
            guard let set, set.allSatisfy({ test($0, v) }) else { return false }
            if v.pre.isEmpty { return true }
            return set.contains { !$0.version.pre.isEmpty && ($0.version.major, $0.version.minor, $0.version.patch) == (v.major, v.minor, v.patch) }
        }
    }

    static func parse(_ value: String) -> Version? {
        guard let groups = match(versionPattern, value.trimmingCharacters(in: .whitespaces)) else { return nil }
        guard let major = groups[1].flatMap(Int.init), let minor = groups[2].flatMap(Int.init), let patch = groups[3].flatMap(Int.init) else { return nil }
        return Version(major: major, minor: minor, patch: patch, pre: groups[4]?.components(separatedBy: ".") ?? [])
    }

    private static func compareIdentifiers(_ a: String, _ b: String) -> Int {
        let (x, y) = (a.allSatisfy(\.isASCIIDigit) ? Int(a) : nil, b.allSatisfy(\.isASCIIDigit) ? Int(b) : nil)
        switch (x, y) {
        case let (x?, y?): return x < y ? -1 : x > y ? 1 : 0
        case (_?, nil): return -1
        case (nil, _?): return 1
        case (nil, nil): return a < b ? -1 : a > b ? 1 : 0
        }
    }

    static func compare(_ a: Version, _ b: Version) -> Int {
        for (x, y) in [(a.major, b.major), (a.minor, b.minor), (a.patch, b.patch)] where x != y {
            return x < y ? -1 : 1
        }
        if a.pre.isEmpty || b.pre.isEmpty { return a.pre.count == b.pre.count ? 0 : a.pre.isEmpty ? 1 : -1 }
        for (x, y) in zip(a.pre, b.pre) {
            let order = compareIdentifiers(x, y)
            if order != 0 { return order }
        }
        return a.pre.count == b.pre.count ? 0 : a.pre.count < b.pre.count ? -1 : 1
    }

    /// The comparators a partial version with an operator stands for: `.some(nil)` when it matches nothing,
    /// `nil` when it doesn't parse.
    private static func desugar(_ op: String, _ value: String) -> [Comparator]?? {
        guard let groups = match(partialPattern, value) else { return nil }
        func number(_ part: String?) -> Int? { part.flatMap { $0.allSatisfy(\.isASCIIDigit) ? Int($0) : nil } }
        // Once a part is a wildcard, the ones after it are too: `1.x.3` reads as `1.x`.
        guard let M = number(groups[1]) else { return op == "<" || op == ">" ? .some(nil) : [] }
        let m = number(groups[2])
        let p = m == nil ? nil : number(groups[3])
        let pre = p != nil ? groups[4]?.components(separatedBy: ".") ?? [] : []

        let nextMajor = Version(major: M + 1, minor: 0, patch: 0, pre: low)
        let next = m.map { Version(major: M, minor: $0 + 1, patch: 0, pre: low) } ?? nextMajor
        let lowest = Version(major: M, minor: m ?? 0, patch: p ?? 0, pre: pre)
        switch op {
        case "", "=":
            return p == nil ? [Comparator(op: .ge, version: lowest), Comparator(op: .lt, version: next)] : [Comparator(op: .eq, version: lowest)]
        case "~":
            return [Comparator(op: .ge, version: lowest), Comparator(op: .lt, version: next)]
        case "^":
            let upper: Version
            if let m, M == 0 {
                upper = m > 0 || p == nil ? Version(major: 0, minor: m + 1, patch: 0, pre: low) : Version(major: 0, minor: 0, patch: p! + 1, pre: low)
            } else {
                upper = nextMajor
            }
            return [Comparator(op: .ge, version: lowest), Comparator(op: .lt, version: upper)]
        case ">":
            return p == nil ? [Comparator(op: .ge, version: Version(major: next.major, minor: next.minor, patch: 0))] : [Comparator(op: .gt, version: lowest)]
        case ">=":
            return [Comparator(op: .ge, version: lowest)]
        case "<":
            return [Comparator(op: .lt, version: p == nil ? Version(major: M, minor: m ?? 0, patch: 0, pre: low) : lowest)]
        case "<=":
            return p == nil ? [Comparator(op: .lt, version: next)] : [Comparator(op: .le, version: lowest)]
        default:
            return nil
        }
    }

    /// One `||` alternative: `.some(nil)` when it matches nothing, `nil` when it doesn't parse.
    private static func parseSet(_ set: String) -> [Comparator]?? {
        if let groups = match(hyphenPattern, set), let a = groups[1], let b = groups[2] {
            guard let low = desugar(">=", a), let high = desugar("<=", b) else { return nil }
            guard let low, let high else { return .some(nil) }
            return low + high
        }
        let joined = spacedOperator.stringByReplacingMatches(in: set, range: NSRange(set.startIndex..., in: set), withTemplate: "$1")
        var comparators: [Comparator] = []
        var none = false
        for token in joined.split(whereSeparator: \.isWhitespace).map(String.init) {
            let op = ["<=", ">=", "<", ">", "=", "^", "~"].first { token.hasPrefix($0) } ?? ""
            guard let desugared = desugar(op, String(token.dropFirst(op.count))) else { return nil }
            if let desugared { comparators += desugared } else { none = true }
        }
        return none ? .some(nil) : comparators
    }

    private static func test(_ comparator: Comparator, _ v: Version) -> Bool {
        let order = compare(v, comparator.version)
        switch comparator.op {
        case .lt: return order < 0
        case .le: return order <= 0
        case .gt: return order > 0
        case .ge: return order >= 0
        case .eq: return order == 0
        }
    }

    /// The capture groups of a whole-string match (index 0 is the match), nil when it doesn't match.
    private static func match(_ regex: NSRegularExpression, _ string: String) -> [String?]? {
        guard let result = regex.firstMatch(in: string, range: NSRange(string.startIndex..., in: string)) else { return nil }
        return (0..<result.numberOfRanges).map { index in
            Range(result.range(at: index), in: string).map { String(string[$0]) }
        }
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
