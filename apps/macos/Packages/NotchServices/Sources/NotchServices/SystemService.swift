import AppKit
import UserNotifications

/// `clipboard.writeText`, `clipboard.readText` and `notifications.send`: what the platform host asks of the
/// machine beyond the plugin services.
@MainActor
public final class SystemService: NSObject, NotchService, UNUserNotificationCenterDelegate {
    public let methods = ["clipboard.writeText", "clipboard.readText", "notifications.send"]
    public weak var sink: ServiceSink?

    override public init() {
        super.init()
    }

    public func handle(method: String, params: Data) async throws -> Data? {
        switch method {
        case "clipboard.writeText":
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            guard pasteboard.setString(try decode(TextParams.self, params).text, forType: .string) else {
                throw ServiceError("couldn't write to the pasteboard")
            }
            return nil
        case "clipboard.readText":
            return TextResult(text: NSPasteboard.general.string(forType: .string) ?? "").json()
        case "notifications.send":
            try await notify(try decode(NotificationParams.self, params))
            return nil
        default:
            throw ServiceError("unknown method \(method)")
        }
    }

    private func notify(_ request: NotificationParams) async throws {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            guard try await center.requestAuthorization(options: [.alert, .sound]) else { throw ServiceError("notifications are off for Just Notch") }
        case .denied:
            throw ServiceError("notifications are off for Just Notch")
        default:
            break
        }
        let content = UNMutableNotificationContent()
        content.title = request.title
        if let body = request.body { content.body = body }
        content.sound = .default
        try await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    /// Show banners even while the app counts as frontmost (the island has focus).
    public nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
