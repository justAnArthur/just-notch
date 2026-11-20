import Foundation
import Testing
@testable import NotchServices

@Suite("AppSupport") struct AppSupportTests {
    let base = URL(fileURLWithPath: "/Users/me/Library/Application Support", isDirectory: true)

    @Test func releaseAndDebugGetTheirOwnFolders() {
        #expect(AppSupport.folder(bundleId: "com.justanarthur.justnotch", base: base).path == "/Users/me/Library/Application Support/JustNotch")
        #expect(AppSupport.folder(bundleId: "com.justanarthur.justnotch.debug", base: base).path == "/Users/me/Library/Application Support/JustNotch Debug")
    }

    @Test func anythingElseIsRelease() {
        // Tests, previews and unknown hosts: only a `.debug` id gets the Debug folder.
        for id in [nil, "com.apple.dt.xctest.tool", "com.justanarthur.justnotch.debugger", "com.example.debug.app"] {
            #expect(AppSupport.folder(bundleId: id, base: base).lastPathComponent == "JustNotch")
        }
        #expect(AppSupport.folder(bundleId: "com.example.app.debug", base: base).lastPathComponent == "JustNotch Debug")
    }
}
