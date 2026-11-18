import Foundation
import Testing
@testable import NotchServices

/// packages/bridge-schema/test/host-cases.json: the cases the TS `hostAllowed` runs.
private struct HostCases: Decodable {
    struct Allowed: Decodable {
        let patterns: [String]
        let url: String
        let expected: Bool

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            patterns = try c.decode([String].self)
            url = try c.decode(String.self)
            expected = try c.decode(Bool.self)
        }
    }

    struct Pair: Decodable {
        let value: String
        let expected: Bool

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            value = try c.decode(String.self)
            expected = try c.decode(Bool.self)
        }
    }

    let valid: [String]
    let invalid: [String]
    let allowed: [Allowed]
    let local: [Pair]
    let scheme: [Pair]

    static let shared: HostCases = {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() // Tests/NotchServicesTests/x.swift → NotchServices
            .appendingPathComponent("../../../../packages/bridge-schema/test/host-cases.json").standardizedFileURL
        return try! JSONDecoder().decode(HostCases.self, from: Data(contentsOf: file))
    }()
}

@Suite("HostPattern matches bridge-schema")
struct HostPatternTests {
    @Test func valid() {
        for pattern in HostCases.shared.valid { #expect(HostPattern.isValid(pattern), "\(pattern)") }
        for pattern in HostCases.shared.invalid { #expect(!HostPattern.isValid(pattern), "\(pattern)") }
    }

    @Test func allowed() {
        for c in HostCases.shared.allowed {
            let allowed = URL(string: c.url).map { HostPattern.allowed(c.patterns, url: $0) } ?? false
            #expect(allowed == c.expected, "\(c.patterns) \(c.url)")
        }
    }

    @Test func localAndScheme() {
        for c in HostCases.shared.local { #expect(HostPattern.isLocal(c.value) == c.expected, "\(c.value)") }
        for c in HostCases.shared.scheme { #expect(HostPattern.schemeAllowed(URL(string: c.value)!) == c.expected, "\(c.value)") }
    }

    @Test func key() {
        #expect(HostPattern.key(URL(string: "https://YouTrack.Acme.com/x")!) == "youtrack.acme.com")
        #expect(HostPattern.key(URL(string: "https://host:8443/x")!) == "host:8443")
        #expect(HostPattern.key(URL(string: "https://host:443/x")!) == "host")
    }
}

// MARK: HTTPProxy

private final class Stub: URLProtocol, @unchecked Sendable {
    struct Reply {
        var status = 200
        var headers: [String: String] = [:]
        var body = Data()
        var redirect: String?
    }

    nonisolated(unsafe) static var replies: [String: Reply] = [:]
    nonisolated(unsafe) static var seen: [URLRequest] = []
    static let lock = NSLock()

    static func reply(_ url: String, _ reply: Reply) {
        lock.lock()
        replies[url] = reply
        lock.unlock()
    }

    static func requests(to host: String) -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return seen.filter { $0.url?.host == host }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.seen.append(request)
        let reply = Self.replies[request.url!.absoluteString] ?? Reply(status: 404)
        Self.lock.unlock()
        var headers = reply.headers
        if let redirect = reply.redirect {
            headers["Location"] = redirect
            let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: headers)!
            var next = URLRequest(url: URL(string: redirect)!)
            next.allHTTPHeaderFields = request.allHTTPHeaderFields
            client?.urlProtocol(self, wasRedirectedTo: next, redirectResponse: response)
            return
        }
        headers["Content-Length"] = headers["Content-Length"] ?? String(reply.body.count)
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private func proxy() -> HTTPProxy {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [Stub.self]
    return HTTPProxy(version: "1.2.3", configuration: configuration)
}

private func request(_ object: [String: Any]) throws -> NetRequest {
    try NetRequest(json: JSONSerialization.data(withJSONObject: object))
}

private let anyHost: @Sendable (URL) -> Bool = { _ in true }

@Suite("HTTPProxy", .serialized)
struct HTTPProxyTests {
    @Test func parsesRequests() throws {
        let r = try request(["url": "https://a.test/x", "method": "post", "json": ["a": 1], "timeoutMs": 10,
                             "headers": ["Cookie": "x", "Host": "evil", "X-Ok": "1"]])
        #expect(r.method == "POST")
        #expect(r.headers == ["X-Ok": "1", "Content-Type": "application/json"])
        #expect(r.body == Data(#"{"a":1}"#.utf8))
        #expect(r.timeoutMs == 1_000)
        #expect(throws: ServiceError.self) { try request(["url": "https://a.test", "body": "x", "json": 1]) }
        #expect(throws: ServiceError.self) { try request(["url": "https://a.test", "method": "TRACE"]) }
        #expect(throws: ServiceError.self) { try request(["url": "/relative"]) }
    }

    @Test func textAndBase64() async throws {
        Stub.reply("https://text.test/a", .init(headers: ["Content-Type": "application/json", "X-Rate": "5"], body: Data(#"{"ok":true}"#.utf8)))
        let response = try await proxy().fetch(try request(["url": "https://text.test/a"]), plugin: "p", allowed: anyHost)
        #expect(response.status == 200)
        #expect(response.encoding == "text")
        #expect(response.body == #"{"ok":true}"#)
        #expect(response.headers["x-rate"] == "5")
        #expect(Stub.requests(to: "text.test").last?.value(forHTTPHeaderField: "User-Agent") == "JustNotch/1.2.3")

        Stub.reply("https://text.test/png", .init(headers: ["Content-Type": "image/png"], body: Data([0, 1, 2])))
        let png = try await proxy().fetch(try request(["url": "https://text.test/png"]), plugin: "p", allowed: anyHost)
        #expect(png.encoding == "base64")
        #expect(png.body == "AAEC")
    }

    @Test func refusesHostsAndSchemes() async throws {
        let only: @Sendable (URL) -> Bool = { HostPattern.allowed(["ok.test"], url: $0) }
        await #expect(throws: ServiceError.self) { try await proxy().fetch(try request(["url": "https://nope.test/"]), plugin: "p", allowed: only) }
        await #expect(throws: ServiceError.self) { try await proxy().fetch(try request(["url": "http://ok.test/"]), plugin: "p", allowed: only) }
    }

    @Test func rejectsLargeBodies() async throws {
        Stub.reply("https://big.test/declared", .init(headers: ["Content-Length": String(HTTPProxy.maxBytes + 1)], body: Data(count: 10)))
        await #expect(throws: ServiceError.self) { try await proxy().fetch(try request(["url": "https://big.test/declared"]), plugin: "p", allowed: anyHost) }
        Stub.reply("https://big.test/streamed", .init(headers: ["Content-Length": "1"], body: Data(count: HTTPProxy.maxBytes + 1)))
        await #expect(throws: ServiceError.self) { try await proxy().fetch(try request(["url": "https://big.test/streamed"]), plugin: "p", allowed: anyHost) }
    }

    @Test func redirects() async throws {
        let allowed: @Sendable (URL) -> Bool = { HostPattern.allowed(["a.test", "b.test"], url: $0) }
        Stub.reply("https://a.test/start", .init(redirect: "https://b.test/end"))
        Stub.reply("https://b.test/end", .init(headers: ["Content-Type": "text/plain"], body: Data("done".utf8)))
        let response = try await proxy().fetch(try request(["url": "https://a.test/start", "headers": ["Authorization": "Bearer t"]]),
                                                plugin: "p", allowed: allowed)
        #expect(response.body == "done")
        #expect(response.url == "https://b.test/end")
        #expect(Stub.requests(to: "b.test").last?.value(forHTTPHeaderField: "Authorization") == nil)

        Stub.reply("https://a.test/escape", .init(redirect: "https://evil.test/"))
        await #expect(throws: ServiceError.self) { try await proxy().fetch(try request(["url": "https://a.test/escape"]), plugin: "p", allowed: allowed) }
        #expect(Stub.requests(to: "evil.test").isEmpty)
    }
}

// MARK: SecretsStore

private final class MemoryBackend: SecretsBackend, @unchecked Sendable {
    var data: Data?
    var writes = 0
    func read() throws -> Data? { data }
    func write(_ data: Data?) throws {
        self.data = data
        writes += 1
    }
}

@Suite("SecretsStore")
struct SecretsStoreTests {
    @Test func oneBlobForAllPlugins() async throws {
        let backend = MemoryBackend()
        let store = SecretsStore(backend: backend)
        #expect(try await store.get(plugin: "github", key: "token") == nil)
        try await store.set(plugin: "github", key: "token", value: "ghp_1")
        try await store.set(plugin: "youtrack", key: "token", value: "perm:2")
        #expect(try await store.get(plugin: "github", key: "token") == "ghp_1")
        #expect(String(decoding: backend.data!, as: UTF8.self) == #"{"github":{"token":"ghp_1"},"youtrack":{"token":"perm:2"}}"#)

        let reread = SecretsStore(backend: backend)
        #expect(try await reread.get(plugin: "youtrack", key: "token") == "perm:2")

        try await store.delete(plugin: "github", key: "token")
        #expect(try await store.get(plugin: "github", key: "token") == nil)
        try await store.deleteAll(plugin: "youtrack")
        #expect(backend.data == nil)
    }

    @Test func validates() async throws {
        let store = SecretsStore(backend: MemoryBackend())
        await #expect(throws: ServiceError.self) { try await store.set(plugin: "p", key: "bad key", value: "x") }
        await #expect(throws: ServiceError.self) { try await store.set(plugin: "p", key: String(repeating: "k", count: 65), value: "x") }
        await #expect(throws: ServiceError.self) { try await store.set(plugin: "p", key: "k", value: String(repeating: "x", count: 64 * 1024 + 1)) }
        try await store.set(plugin: "p", key: "a.b_c-1", value: String(repeating: "x", count: 64 * 1024))
    }
}
