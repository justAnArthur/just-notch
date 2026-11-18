import Foundation

/// bridge-schema `NetRequest`, parsed from the bridge's JSON params.
public struct NetRequest: Sendable {
    public static let methods: Set<String> = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]
    static let droppedHeaders: Set<String> = ["host", "content-length", "connection", "cookie"]

    public var url: URL
    public var method: String
    public var headers: [String: String]
    public var body: Data?
    public var timeoutMs: Int
    public var responseType: String?

    public init(json data: Data) throws {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ServiceError("net.fetch needs an object") }
        guard let raw = object["url"] as? String, let url = URL(string: raw), url.host != nil else { throw ServiceError("net.fetch needs an absolute url") }
        self.url = url
        method = (object["method"] as? String)?.uppercased() ?? "GET"
        guard Self.methods.contains(method) else { throw ServiceError("net.fetch: unsupported method \(method)") }
        headers = [:]
        for (name, value) in object["headers"] as? [String: Any] ?? [:] {
            guard let value = value as? String else { throw ServiceError("net.fetch: header \(name) must be a string") }
            if !Self.droppedHeaders.contains(name.lowercased()) { headers[name] = value }
        }
        let present = { (key: String) in object[key].flatMap { $0 is NSNull ? nil : $0 } }
        switch (present("body"), present("json")) {
        case (nil, nil):
            body = nil
        case (let text as String, nil):
            body = Data(text.utf8)
        case (nil, let json?):
            body = try JSONSerialization.data(withJSONObject: json, options: .fragmentsAllowed)
            if !headers.keys.contains(where: { $0.lowercased() == "content-type" }) { headers["Content-Type"] = "application/json" }
        default:
            throw ServiceError("net.fetch takes either body (a string) or json, not both")
        }
        let timeout = (object["timeoutMs"] as? NSNumber)?.intValue ?? 15_000
        timeoutMs = min(60_000, max(1_000, timeout))
        responseType = object["responseType"] as? String
        if let responseType, !["text", "base64"].contains(responseType) { throw ServiceError("net.fetch: responseType is text or base64") }
    }
}

/// bridge-schema `NetResponse`.
public struct NetResponse: Encodable, Sendable {
    public var status: Int
    public var url: String
    public var headers: [String: String]
    public var body: String
    public var encoding: String
}

/// `net.fetch`: a cookie-less, cache-less URLSession that re-checks every redirect hop against the
/// plugin's allowed hosts and caps responses at `maxBytes`.
public final class HTTPProxy: @unchecked Sendable {
    public static let maxBytes = 5 * 1024 * 1024
    public static let maxInFlight = 6

    private let session: URLSession
    private let lock = NSLock()
    private var inFlight: [String: Int] = [:]

    public init(version: String, configuration: URLSessionConfiguration = .ephemeral) {
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.httpAdditionalHeaders = ["User-Agent": "JustNotch/\(version)"]
        session = URLSession(configuration: configuration)
    }

    /// `allowed` answers for the first URL and every redirect target. Cancel the calling task to abort.
    public func fetch(_ request: NetRequest, plugin: String, allowed: @escaping @Sendable (URL) -> Bool) async throws -> NetResponse {
        try check(request.url, allowed)
        try acquire(plugin)
        defer { release(plugin) }

        var urlRequest = URLRequest(url: request.url, timeoutInterval: Double(request.timeoutMs) / 1000)
        urlRequest.httpMethod = request.method
        urlRequest.httpBody = request.body
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }

        let redirects = RedirectGuard(origin: request.url.host?.lowercased(), allowed: allowed)
        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (bytes, response) = try await session.bytes(for: urlRequest, delegate: redirects)
        } catch {
            throw redirects.blocked ?? error
        }
        if let blocked = redirects.blocked { throw blocked }
        guard let http = response as? HTTPURLResponse else { throw ServiceError("net.fetch: not an HTTP response") }
        if http.expectedContentLength > Self.maxBytes { throw Self.tooLarge }

        var data = Data()
        if http.expectedContentLength > 0 { data.reserveCapacity(Int(http.expectedContentLength)) }
        for try await byte in bytes {
            data.append(byte)
            if data.count > Self.maxBytes { throw Self.tooLarge }
        }

        var headers: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
            if let name = name as? String { headers[name.lowercased()] = "\(value)" }
        }
        let type = request.responseType ?? Self.responseType(headers["content-type"])
        return NetResponse(status: http.statusCode, url: http.url?.absoluteString ?? request.url.absoluteString, headers: headers,
                           body: type == "text" ? String(decoding: data, as: UTF8.self) : data.base64EncodedString(), encoding: type)
    }

    static func responseType(_ contentType: String?) -> String {
        let type = contentType?.lowercased() ?? ""
        return type.hasPrefix("text/") || type.contains("json") || type.contains("xml") ? "text" : "base64"
    }

    private static let tooLarge = ServiceError("net.fetch: the response is larger than 5 MiB")

    fileprivate static func problem(_ url: URL, _ allowed: (URL) -> Bool) -> ServiceError? {
        guard HostPattern.schemeAllowed(url) else { return ServiceError("net.fetch needs https (http only for local hosts): \(url.absoluteString)") }
        guard allowed(url) else { return ServiceError("net.fetch: \(HostPattern.key(url) ?? url.absoluteString) is not in the plugin's hosts; ask with net.requestHost") }
        return nil
    }

    private func check(_ url: URL, _ allowed: (URL) -> Bool) throws {
        if let problem = Self.problem(url, allowed) { throw problem }
    }

    private func acquire(_ plugin: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard inFlight[plugin, default: 0] < Self.maxInFlight else {
            throw ServiceError("net.fetch: \(plugin) already has \(Self.maxInFlight) requests in flight")
        }
        inFlight[plugin, default: 0] += 1
    }

    private func release(_ plugin: String) {
        lock.lock()
        defer { lock.unlock() }
        inFlight[plugin] = inFlight[plugin, default: 1] - 1 == 0 ? nil : inFlight[plugin, default: 1] - 1
    }
}

/// Per task: refuses a redirect to a host or scheme the plugin may not reach, and drops
/// `Authorization` once the request leaves the host it was meant for.
private final class RedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let origin: String?
    private let allowed: @Sendable (URL) -> Bool
    private let lock = NSLock()
    private var _blocked: ServiceError?

    var blocked: ServiceError? {
        lock.lock()
        defer { lock.unlock() }
        return _blocked
    }

    init(origin: String?, allowed: @escaping @Sendable (URL) -> Bool) {
        self.origin = origin
        self.allowed = allowed
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url else { return completionHandler(nil) }
        if let problem = HTTPProxy.problem(url, allowed) {
            lock.lock()
            _blocked = ServiceError("redirect refused: \(problem.message)")
            lock.unlock()
            task.cancel()
            return completionHandler(nil)
        }
        var next = request
        if url.host?.lowercased() != origin { next.setValue(nil, forHTTPHeaderField: "Authorization") }
        completionHandler(next)
    }
}
