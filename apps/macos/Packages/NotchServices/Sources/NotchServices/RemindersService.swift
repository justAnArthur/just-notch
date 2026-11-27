import AppKit
import EventKit

/// `reminders` topic (incomplete reminders due by the end of today, overdue ones included) and `reminders.*`:
/// add, complete and snooze them in Apple Reminders, so they sync to the phone. Needs Reminders access, asked for
/// only by `reminders.requestAccess`.
@MainActor
public final class RemindersService: NotchService {
    public let topics = ["reminders"]
    public let methods = ["reminders.requestAccess", "reminders.add", "reminders.complete", "reminders.snooze"]
    public weak var sink: ServiceSink?

    private let store = EKEventStore()
    private var timer: Timer?
    private var observer: NSObjectProtocol?
    private var latest = Latest<RemindersState>()

    public init() {}

    public func start(topic: String) {
        guard timer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        // A reminder comes due without the store changing: look again every half minute.
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
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
        await read().json()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "reminders.requestAccess":
            let granted = (try? await store.requestFullAccessToReminders()) ?? false
            store.reset()
            refresh()
            return GrantedResult(granted: granted).json()
        case "reminders.add":
            struct Params: Decodable {
                var title: String
                var due: Double?
            }
            let params = try decode(Params.self, params)
            try requireAccess()
            let title = params.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else { throw ServiceError("a reminder needs a title") }
            guard let list = store.defaultCalendarForNewReminders() else { throw ServiceError("no Reminders list to add to") }
            let reminder = EKReminder(eventStore: store)
            reminder.title = String(title.prefix(500))
            reminder.calendar = list
            if let due = params.due { Self.setDue(reminder, Date(timeIntervalSince1970: due / 1000)) }
            try store.save(reminder, commit: true)
            refresh()
            return ReminderId(id: reminder.calendarItemIdentifier).json()
        case "reminders.complete", "reminders.snooze":
            struct Params: Decodable {
                var id: String
                var minutes: Double?
            }
            let params = try decode(Params.self, params)
            try requireAccess()
            guard let reminder = store.calendarItem(withIdentifier: params.id) as? EKReminder else { throw ServiceError("that reminder is gone") }
            if method == "reminders.complete" {
                reminder.isCompleted = true
            } else {
                Self.setDue(reminder, Date().addingTimeInterval(max(1, params.minutes ?? 10) * 60))
            }
            try store.save(reminder, commit: true)
            refresh()
            return nil
        default:
            throw ServiceError("unknown method \(method)")
        }
    }

    private func requireAccess() throws {
        guard Self.access() == .granted else { throw ServiceError("Just Notch can't use Reminders: allow it in System Settings › Privacy & Security › Reminders") }
    }

    /// A due date with a time, and an alarm at it, so Reminders on the phone rings too.
    private static func setDue(_ reminder: EKReminder, _ date: Date) {
        reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        reminder.alarms?.forEach(reminder.removeAlarm)
        reminder.addAlarm(EKAlarm(absoluteDate: date))
    }

    private func refresh() {
        Task {
            let state = await read()
            guard latest.update(state), let data = state.json() else { return }
            sink?.publish(topic: "reminders", value: data)
        }
    }

    private func read() async -> RemindersState {
        let access = Self.access()
        guard access == .granted else { return RemindersState(access: access, due: []) }
        let end = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())) ?? Date()
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: end, calendars: nil)
        let store = store
        let found: [Reminder] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { reminders in
                let items = (reminders ?? []).compactMap(Self.reminder).sorted { $0.due < $1.due }
                continuation.resume(returning: items)
            }
        }
        return RemindersState(access: access, due: Array(found.prefix(50)))
    }

    private static func access() -> RemindersState.Access {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .fullAccess: .granted
        case .notDetermined: .undetermined
        default: .denied
        }
    }

    nonisolated private static func reminder(_ item: EKReminder) -> Reminder? {
        guard let components = item.dueDateComponents, let date = Calendar.current.date(from: components) else { return nil }
        // A reminder with a day but no time is due at the start of that day; it counts from 9:00, as Reminders shows it.
        let due = components.hour == nil ? Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: date) ?? date : date
        return Reminder(
            id: item.calendarItemIdentifier,
            title: item.title ?? "",
            due: (due.timeIntervalSince1970 * 1000).rounded(),
            list: item.calendar?.title ?? "",
            listColor: CalendarService.hex(item.calendar?.color)
        )
    }
}

/// bridge-schema `RemindersState`.
public struct RemindersState: Codable, Equatable, Sendable {
    public enum Access: String, Codable, Sendable {
        case granted, denied, undetermined
    }

    public var access: Access
    public var due: [Reminder]
}

/// bridge-schema `Reminder`.
public struct Reminder: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    /// Epoch ms.
    public var due: Double
    public var list: String
    public var listColor: String
}

struct ReminderId: Codable {
    var id: String
}
