import AppKit
import ApplicationServices
import Testing
@testable import NotchServices

@Suite("Accessibility errors") @MainActor
struct WindowsServiceTests {
    private let app = NSRunningApplication.current

    @Test func staleGrantNamesAccessibility() {
        let message = WindowsService.error(.apiDisabled, app: app).message
        #expect(message.hasPrefix(WindowsService.accessibilityMessage))
        #expect(message.contains("off and on again"))
    }

    @Test func otherFailuresSayWhat() {
        let name = app.localizedName ?? "The app in front"
        #expect(WindowsService.error(.invalidUIElement, app: app).message == "The window closed")
        #expect(WindowsService.error(.cannotComplete, app: app).message == "\(name) didn't answer")
        #expect(WindowsService.error(.attributeUnsupported, app: app).message == "\(name) doesn't let its windows be moved")
        #expect(WindowsService.error(.failure, app: app).message.contains("AXError"))
    }
}
