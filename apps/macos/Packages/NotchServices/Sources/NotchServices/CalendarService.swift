import AppKit
import EventKit

enum MeetingURL {
    private static let pattern = try! NSRegularExpression(
        pattern: #"https?://(?:[a-z0-9-]+\.)*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)(?:/[^\s<>"'\)\]]*)?"#,
        options: [.caseInsensitive]
    )

    /// The first video-call link in these texts, in order (event url, location, notes).
    static func extract(from texts: [String?]) -> String? {
        for case let text? in texts {
            let range = NSRange(text.startIndex..., in: text)
            for match in pattern.matches(in: text, range: range) {
                guard let found = Range(match.range, in: text) else { continue }
                let link = String(text[found])
                if isMeeting(link) { return link }
            }
        }
        return nil
    }

    /// A bare host (meet.google.com, zoom.us) is a homepage, not a meeting.
    private static func isMeeting(_ link: String) -> Bool {
        guard let url = URL(string: link) else { return false }
        return url.path.count > 1
    }
}

/// `calendar` topic and `calendar.requestAccess` through EventKit.
@MainActor
public final class CalendarService: NotchService {
    public let topics = ["calendar"]
    public let methods = ["calendar.requestAccess"]
    public weak var sink: ServiceSink?

    private let store = EKEventStore()
    private var timer: Timer?
    private var observer: NSObjectProtocol?
    private var latest = Latest<CalendarState>()

    public init() {}

    public func start(topic: String) {
        guard timer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refresh()
    }

    public func stop(topic: String) {
        timer?.invalidate()
        timer = nil
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        latest.reset()
    }

    public func snapshot(topic: String) async -> Data? {
        read().json()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "calendar.requestAccess" else { throw ServiceError("unknown method \(method)") }
        let granted = (try? await store.requestFullAccessToEvents()) ?? false
        if timer != nil {
            store.reset()
            refresh()
        }
        return GrantedResult(granted: granted).json()
    }

    private func refresh() {
        let state = read()
        guard latest.update(state), let data = state.json() else { return }
        sink?.publish(topic: "calendar", value: data)
    }

    private func read() -> CalendarState {
        let access = Self.access()
        guard access == .granted else { return CalendarState(access: access, upcoming: []) }

        let now = Date()
        let calendar = Calendar.current
        // Today and the next six days: the tall agenda lists the week ahead.
        let end = calendar.date(byAdding: .day, value: 7, to: calendar.startOfDay(for: now)) ?? now
        let predicate = store.predicateForEvents(withStart: now, end: end, calendars: nil)
        let events = store.events(matching: predicate)
            .sorted { $0.startDate < $1.startDate }
            .map(Self.event)
        return CalendarState(access: access, upcoming: events)
    }

    private static func access() -> CalendarState.Access {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: .granted
        case .notDetermined: .undetermined
        default: .denied
        }
    }

    private static func event(_ event: EKEvent) -> CalendarEvent {
        let start = event.startDate.timeIntervalSince1970 * 1000
        let location = event.location?.isEmpty == false ? event.location : nil
        return CalendarEvent(
            id: "\(event.calendarItemIdentifier)@\(Int(start))",
            title: event.title ?? "",
            start: start,
            end: event.endDate.timeIntervalSince1970 * 1000,
            allDay: event.isAllDay,
            calendarColor: hex(event.calendar?.color),
            location: location,
            meetingUrl: MeetingURL.extract(from: [event.url?.absoluteString, event.location, event.notes])
        )
    }

    static func hex(_ color: NSColor?) -> String {
        guard let rgb = color?.usingColorSpace(.sRGB) else { return "#808080" }
        func channel(_ value: CGFloat) -> Int { Int((min(1, max(0, value)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", channel(rgb.redComponent), channel(rgb.greenComponent), channel(rgb.blueComponent))
    }
}
