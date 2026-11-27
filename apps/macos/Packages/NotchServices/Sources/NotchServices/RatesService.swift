import Foundation

/// `rates.currency`: the ECB's daily euro reference rates, with what the ECB leaves out (the hryvnia among
/// them) crossed through the National Bank of Ukraine's official rates. Kept in memory and in Application Support so the
/// launcher converts offline. Fetched at most every 12 h; a failed fetch is retried after a few minutes.
@MainActor
public final class RatesService: NotchService {
    public let methods = ["rates.currency"]
    public weak var sink: ServiceSink?

    static let source = URL(string: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")!
    static let nbu = URL(string: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json")!
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
        // A cache from before the NBU rates, or from when they failed, is refreshed sooner.
        let maxAge = cache?.rates.extra == nil ? Self.retryAfter : Self.maxAge
        if let cache, now.timeIntervalSince(cache.fetchedAt) < maxAge { return cache.rates }
        if let lastAttempt, now.timeIntervalSince(lastAttempt) < Self.retryAfter { return cache?.rates }
        if let inFlight { return await inFlight.value }
        lastAttempt = now
        let session = session
        let task = Task { () -> CurrencyRates? in
            async let nbu = Self.fetch(Self.nbu, session)
            guard let data = await Self.fetch(Self.source, session), let rates = ECBParser.parse(data) else { return nil }
            return NBURates.merge(await nbu, into: rates)
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

    private nonisolated static func fetch(_ url: URL, _ session: URLSession) async -> Data? {
        guard let (data, response) = try? await session.data(from: url), (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return data
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

/// The National Bank of Ukraine's official rates: `[{"cc":"EUR","rate":49.49,"exchangedate":"27.11.2026"},…]`,
/// hryvnias for one unit of each currency.
enum NBURates {
    static func merge(_ data: Data?, into ecb: CurrencyRates) -> CurrencyRates {
        struct Row: Decodable {
            var cc: String
            var rate: Double
            var exchangedate: String
        }
        guard let data, let rows = try? JSONDecoder().decode([Row].self, from: data),
              let euro = rows.first(where: { $0.cc == "EUR" }), euro.rate > 0 else { return ecb }
        var merged = ecb
        merged.rates["UAH"] = euro.rate
        var codes = ["UAH"]
        // Metals (XAU…) and the IMF's XDR aren't currencies to convert to.
        for row in rows where row.rate > 0 && !row.cc.hasPrefix("X") && row.cc != "EUR" && ecb.rates[row.cc] == nil {
            merged.rates[row.cc] = euro.rate / row.rate
            codes.append(row.cc)
        }
        let parts = euro.exchangedate.split(separator: ".")
        let date = parts.count == 3 ? "\(parts[2])-\(parts[1])-\(parts[0])" : ecb.date
        merged.extra = .init(source: "NBU", date: date, codes: codes.sorted())
        return merged
    }
}
