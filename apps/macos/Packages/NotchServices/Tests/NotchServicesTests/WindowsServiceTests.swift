import AppKit
import ApplicationServices
import Testing
@testable import NotchServices

@Suite("Window moves") @MainActor
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

    @Test func animationEasesOutToTheExactFrame() {
        let from = CGRect(x: 100, y: 100, width: 800, height: 600)
        let to = CGRect(x: 0, y: 25, width: 720, height: 875)
        #expect(WindowsService.interpolate(from: from, to: to, t: 0) == from)
        #expect(WindowsService.interpolate(from: from, to: to, t: 1) == to)
        #expect(WindowsService.interpolate(from: from, to: to, t: 2) == to)
        // Ease-out: half the time covers more than half the way.
        #expect(WindowsService.interpolate(from: from, to: to, t: 0.5).minX < 50)
    }

    @Test func reduceMotionAndTinyMovesDontAnimate() {
        let from = CGRect(x: 100, y: 100, width: 800, height: 600)
        #expect(WindowsService.animates(from: from, to: from.offsetBy(dx: 300, dy: 0), reduceMotion: false))
        #expect(!WindowsService.animates(from: from, to: from.offsetBy(dx: 300, dy: 0), reduceMotion: true))
        #expect(!WindowsService.animates(from: from, to: from.offsetBy(dx: 2, dy: 3), reduceMotion: false))
    }

    @Test func tilingIsOnUnlessTurnedOff() {
        let all = MacTiling(edgeDrag: true, topEdgeDrag: true, optionDrag: true, margins: true)
        #expect(WindowsService.tiling({ _ in nil }, macOS15: true) == all)
        let off = WindowsService.tiling({ $0 == "EnableTilingByEdgeDrag" ? false : nil }, macOS15: true)
        #expect(!off.edgeDrag && off.topEdgeDrag)
        #expect(WindowsService.tiling({ _ in true }, macOS15: false) == MacTiling(edgeDrag: false, topEdgeDrag: false, optionDrag: false, margins: false))
    }

    @Test func noAppInFrontIsNull() throws {
        let none: FrontApp? = nil
        #expect(String(decoding: try #require(none.json()), as: UTF8.self) == "null")
    }
}
