import CoreGraphics
import Foundation
import Testing
@testable import NotchServices

@Suite("Presence")
struct PresenceTests {
    private let screens = ["laptop": CGRect(x: 0, y: 0, width: 1512, height: 982), "external": CGRect(x: 1512, y: -300, width: 2560, height: 1440)]

    private func window(_ r: CGRect, layer: Int = 0, pid: pid_t = 42) -> [String: Any] {
        [kCGWindowLayer as String: layer, kCGWindowOwnerPID as String: pid, kCGWindowBounds as String: r.dictionaryRepresentation as NSDictionary]
    }

    @Test func aWindowCoveringAScreenIsFullScreen() {
        let found = Presence.fullScreen(windows: [window(screens["external"]!), window(CGRect(x: 0, y: 25, width: 800, height: 600))], screens: screens, ownPid: 1)
        #expect(found == ["external"])
    }

    @Test func maximizedWindowsMenuBarAndOurOwnPanelDont() {
        let maximized = window(CGRect(x: 0, y: 33, width: 1512, height: 949))
        let menuBar = window(screens["laptop"]!, layer: 24)
        let ours = window(screens["laptop"]!, pid: 1)
        #expect(Presence.fullScreen(windows: [maximized, menuBar, ours], screens: screens, ownPid: 1).isEmpty)
    }
}
