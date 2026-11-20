import Foundation

/// `rates.currency`: the ECB's daily euro reference rates, kept in memory and in Application Support so the
/// launcher converts offline. Fetched at most every 12 h; a failed fetch is retried after a few minutes.
@MainActor
public final class RatesService: NotchService {
    public let methods = ["rates.currency"]
    public weak var sink: ServiceSink?

    static let source = URL(string: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")!
    static let maxAge: TimeInterval = 12 * 3600
    static let retryAfter: TimeInterval = 5 * 60

    private struct Cache: Codable {
        var rates: CurrencyRates
        var fetchedAt: Date
    }

    private let file: URL
    private let session: URLSession
    private var cache: Cache?
    private var lastAttempt: Date?
    private var inFlight: Task<CurrencyRates?, Never>?

    public init(folder: URL = RatesService.defaultFolder) {
        file = folder.appendingPathComponent("rates.json")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 10
        session = URLSession(configuration: configuration)
        cache = (try? Data(contentsOf: file)).flatMap { try? Self.decoder.decode(Cache.self, from: $0) }
    }

    public nonisolated static var defaultFolder: URL {
        AppSupport.folder
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "rates.currency" else { throw ServiceError("unknown method \(method)") }
        return await rates()?.json()
    }

    private func rates() async -> CurrencyRates? {
        let now = Date()
        if let cache, now.timeIntervalSince(cache.fetchedAt) < Self.maxAge { return cache.rates }
        if let lastAttempt, now.timeIntervalSince(lastAttempt) < Self.retryAfter { return cache?.rates }
        if let inFlight { return await inFlight.value }
        lastAttempt = now
        let session = session
        let task = Task { () -> CurrencyRates? in
            guard let (data, response) = try? await session.data(from: Self.source),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let rates = ECBParser.parse(data)
            else { return nil }
            return rates
        }
        inFlight = task
        let fresh = await task.value
        inFlight = nil
        guard let fresh else { return cache?.rates }
        let cache = Cache(rates: fresh, fetchedAt: now)
        self.cache = cache
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Self.encoder.encode(cache).write(to: file, options: .atomic)
        return fresh
    }

    private static let encoder = { let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e }()
    private static let decoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d }()
}

/// `<Cube time="2026-11-19"><Cube currency="USD" rate="1.0812"/>…`
final class ECBParser: NSObject, XMLParserDelegate {
    private var date: String?
    private var rates: [String: Double] = [:]

    static func parse(_ data: Data) -> CurrencyRates? {
        let delegate = ECBParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse(), let date = delegate.date, !delegate.rates.isEmpty else { return nil }
        return CurrencyRates(base: "EUR", date: date, rates: delegate.rates)
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        guard elementName == "Cube" else { return }
        if let time = attributes["time"] { date = time }
        if let currency = attributes["currency"], let rate = attributes["rate"].flatMap(Double.init) { rates[currency] = rate }
    }
}
