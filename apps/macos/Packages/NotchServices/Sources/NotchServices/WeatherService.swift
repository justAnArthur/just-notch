import CoreLocation
import Foundation

/// `weather` topic: an Open-Meteo forecast for the current location (Location
/// Services) or a city the user picked, refreshed every 15 min while subscribed.
/// The last forecast survives unsubscribing and going offline.
@MainActor
public final class WeatherService: NSObject, NotchService, CLLocationManagerDelegate {
    public let topics = ["weather"]
    public let methods = ["weather.requestAccess", "weather.setLocation", "weather.refresh"]
    public weak var sink: ServiceSink?

    static let interval: TimeInterval = 15 * 60
    private static let settingKey = "weather.location"

    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var timer: Timer?
    private var state: WeatherState
    private var located: CheckedContinuation<CLLocation, Error>?
    private var authorized: CheckedContinuation<Bool, Never>?
    private var fetching: Task<Void, Never>?

    override public init() {
        let setting = UserDefaults.standard.data(forKey: Self.settingKey)
            .flatMap { try? JSONDecoder().decode(WeatherLocation.self, from: $0) } ?? .auto
        state = WeatherState(access: .undetermined, status: .loading, setting: setting, hours: [], days: [])
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        state.access = access
    }

    public func start(topic: String) {
        guard timer == nil else { return }
        let timer = Timer(timeInterval: Self.interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        if state.updatedAt.map({ nowMs() - $0 > Self.interval * 1000 }) ?? true { refresh() }
    }

    public func stop(topic: String) {
        timer?.invalidate()
        timer = nil
    }

    public func snapshot(topic: String) async -> Data? {
        state.json()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "weather.requestAccess":
            return GrantedResult(granted: await requestAccess()).json()
        case "weather.setLocation":
            var setting = try decode(WeatherLocation.self, params)
            if setting.mode == .city {
                guard let city = setting.city?.trimmingCharacters(in: .whitespaces), !city.isEmpty else { throw ServiceError("a city is required") }
                setting.city = city
            } else {
                setting.city = nil
            }
            UserDefaults.standard.set(setting.json(), forKey: Self.settingKey)
            update { $0.setting = setting; $0.location = nil }
            refresh()
            return nil
        case "weather.refresh":
            refresh()
            return nil
        default:
            throw ServiceError("unknown method \(method)")
        }
    }

    // MARK: forecast

    private func refresh() {
        guard fetching == nil else { return }
        fetching = Task {
            defer { fetching = nil }
            if state.current == nil { update { $0.status = .loading } }
            do {
                let (coordinate, name) = try await place()
                let forecast = try await Self.forecast(at: coordinate)
                update {
                    $0.status = .ready
                    $0.location = name ?? $0.location
                    $0.current = forecast.current
                    $0.hours = forecast.hours
                    $0.days = forecast.days
                    $0.updatedAt = nowMs()
                }
            } catch let error as URLError where Self.offline.contains(error.code) {
                update { $0.status = .offline }
            } catch {
                update { $0.status = .error }
            }
        }
    }

    private static let offline: Set<URLError.Code> = [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .dataNotAllowed]

    private func place() async throws -> (CLLocationCoordinate2D, String?) {
        if state.setting.mode == .city, let city = state.setting.city {
            guard let mark = try await geocoder.geocodeAddressString(city).first, let location = mark.location else {
                throw ServiceError("no place named \(city)")
            }
            return (location.coordinate, mark.locality ?? mark.name ?? city)
        }
        guard state.access == .granted else { throw ServiceError("location access is \(state.access.rawValue)") }
        let location = try await currentLocation()
        let mark = try? await geocoder.reverseGeocodeLocation(location).first
        return (location.coordinate, mark?.locality ?? mark?.name)
    }

    private func currentLocation() async throws -> CLLocation {
        if let location = manager.location, -location.timestamp.timeIntervalSinceNow < Self.interval { return location }
        located?.resume(throwing: CancellationError())
        return try await withCheckedThrowingContinuation { continuation in
            located = continuation
            manager.requestLocation()
        }
    }

    // MARK: access

    private var access: WeatherState.Access {
        switch manager.authorizationStatus {
        case .notDetermined: .undetermined
        case .denied, .restricted: .denied
        default: .granted
        }
    }

    private func requestAccess() async -> Bool {
        guard access == .undetermined else { return access == .granted }
        authorized?.resume(returning: false)
        let granted = await withCheckedContinuation { continuation in
            authorized = continuation
            manager.requestWhenInUseAuthorization()
        }
        if granted { refresh() }
        return granted
    }

    private func update(_ change: (inout WeatherState) -> Void) {
        var next = state
        change(&next)
        guard next != state else { return }
        state = next
        if timer != nil, let data = state.json() { sink?.publish(topic: "weather", value: data) }
    }

    // MARK: CLLocationManagerDelegate

    public nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated {
            let access = access
            update { $0.access = access }
            guard access != .undetermined else { return }
            authorized?.resume(returning: access == .granted)
            authorized = nil
        }
    }

    public nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        MainActor.assumeIsolated {
            guard let location = locations.last else { return }
            located?.resume(returning: location)
            located = nil
        }
    }

    public nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        MainActor.assumeIsolated {
            located?.resume(throwing: error)
            located = nil
        }
    }
}

// MARK: Open-Meteo

extension WeatherService {
    struct Forecast {
        var current: WeatherNow
        var hours: [WeatherHour]
        var days: [WeatherDay]
    }

    private struct Response: Decodable {
        struct Current: Decodable {
            var time: Double
            var temperature_2m: Double
            var apparent_temperature: Double
            var weather_code: Int
            var is_day: Int
            var wind_speed_10m: Double
            var relative_humidity_2m: Double
            var uv_index: Double?
        }

        struct Hourly: Decodable {
            var time: [Double]
            var temperature_2m: [Double?]
            var weather_code: [Int?]
            var precipitation_probability: [Double?]
            var is_day: [Int?]
        }

        struct Daily: Decodable {
            var time: [Double]
            var weather_code: [Int?]
            var temperature_2m_max: [Double?]
            var temperature_2m_min: [Double?]
            var precipitation_probability_max: [Double?]
        }

        var current: Current
        var hourly: Hourly
        var daily: Daily
    }

    static func url(for coordinate: CLLocationCoordinate2D) -> URL {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.3f", coordinate.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.3f", coordinate.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m,uv_index"),
            URLQueryItem(name: "hourly", value: "temperature_2m,weather_code,precipitation_probability,is_day"),
            URLQueryItem(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            URLQueryItem(name: "timezone", value: "auto"),
            URLQueryItem(name: "timeformat", value: "unixtime"),
            URLQueryItem(name: "forecast_days", value: "7"),
        ]
        return components.url!
    }

    static func forecast(at coordinate: CLLocationCoordinate2D) async throws -> Forecast {
        let (data, response) = try await URLSession.shared.data(from: url(for: coordinate))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw ServiceError("forecast request failed") }
        return try parse(data, now: Date().timeIntervalSince1970)
    }

    /// Open-Meteo JSON (`timeformat=unixtime`) → the schema's shapes: 24 hours from the current one, every day given.
    static func parse(_ data: Data, now: TimeInterval) throws -> Forecast {
        let r = try JSONDecoder().decode(Response.self, from: data)
        let c = r.current
        let current = WeatherNow(
            time: c.time * 1000, temperature: c.temperature_2m, apparent: c.apparent_temperature, code: c.weather_code,
            isDay: c.is_day == 1, wind: c.wind_speed_10m, humidity: c.relative_humidity_2m, uv: c.uv_index ?? 0
        )
        let h = r.hourly
        let hourStart = now - now.truncatingRemainder(dividingBy: 3600)
        let hours = h.time.indices.compactMap { i -> WeatherHour? in
            guard h.time[i] >= hourStart, let temperature = h.temperature_2m[i], let code = h.weather_code[i] else { return nil }
            return WeatherHour(time: h.time[i] * 1000, temperature: temperature, code: code, isDay: h.is_day[i] == 1, precipitation: h.precipitation_probability[i] ?? 0)
        }.prefix(24)
        let d = r.daily
        let days = d.time.indices.compactMap { i -> WeatherDay? in
            guard let code = d.weather_code[i], let high = d.temperature_2m_max[i], let low = d.temperature_2m_min[i] else { return nil }
            return WeatherDay(date: d.time[i] * 1000, code: code, high: high, low: low, precipitation: d.precipitation_probability_max[i] ?? 0)
        }
        return Forecast(current: current, hours: Array(hours), days: days)
    }
}
