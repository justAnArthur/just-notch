import Foundation
import Testing
@testable import NotchServices

@Suite("Shelf")
struct ShelfTests {
    private let base = FileManager.default.temporaryDirectory.appendingPathComponent("shelf-tests-\(UUID().uuidString)")
    private var shelf: Shelf { Shelf(root: base.appendingPathComponent("Shelf")) }

    private func file(_ name: String, bytes: Int) throws -> URL {
        let url = base.appendingPathComponent("in/\(name)")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(count: bytes).write(to: url)
        return url
    }

    @Test func keepsCopiesAndLeavesOriginals() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        let a = try file("a.pdf", bytes: 100)
        let outcome = shelf.keep([a], limitBytes: 1000)
        #expect(outcome.kept.count == 1 && outcome.skipped.isEmpty)
        #expect(FileManager.default.fileExists(atPath: a.path))
        #expect(shelf.items().map(\.url.lastPathComponent) == ["a.pdf"])
        #expect(shelf.contains(outcome.kept[0]))
        #expect(!shelf.contains(a.path))
    }

    @Test func sameNameTwiceKeepsBoth() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        let a = try file("a.pdf", bytes: 10)
        _ = shelf.keep([a], limitBytes: 1000, now: Date(timeIntervalSince1970: 1000))
        _ = shelf.keep([a], limitBytes: 1000, now: Date(timeIntervalSince1970: 2000))
        #expect(shelf.items().count == 2)
    }

    @Test func tooBigMissingOrAlreadyKeptIsSkipped() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        let big = try file("big.mov", bytes: 2000)
        let missing = base.appendingPathComponent("in/gone.txt")
        let kept = shelf.keep([try file("a.txt", bytes: 10)], limitBytes: 1000).kept[0]
        let outcome = shelf.keep([big, missing, URL(fileURLWithPath: kept)], limitBytes: 1000)
        #expect(outcome.kept.isEmpty)
        #expect(outcome.skipped.count == 3)
    }

    @Test func oldestGoPastTheLimit() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        _ = shelf.keep([try file("1.bin", bytes: 400)], limitBytes: 1000, now: Date(timeIntervalSince1970: 1000))
        _ = shelf.keep([try file("2.bin", bytes: 400)], limitBytes: 1000, now: Date(timeIntervalSince1970: 2000))
        _ = shelf.keep([try file("3.bin", bytes: 400)], limitBytes: 1000, now: Date(timeIntervalSince1970: 3000))
        #expect(shelf.items().map(\.url.lastPathComponent) == ["3.bin", "2.bin"])
        #expect(shelf.bytes() <= 1000)
    }

    @Test func expiredItemsGo() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        let now = Date(timeIntervalSince1970: 100_000)
        _ = shelf.keep([try file("old.txt", bytes: 1)], limitBytes: 1000, now: now.addingTimeInterval(-25 * 3600))
        _ = shelf.keep([try file("new.txt", bytes: 1)], limitBytes: 1000, now: now.addingTimeInterval(-3600))
        shelf.trim(limitBytes: 1000, expiryHours: 24, now: now)
        #expect(shelf.items().map(\.url.lastPathComponent) == ["new.txt"])
        shelf.trim(limitBytes: 1000, expiryHours: nil, now: now.addingTimeInterval(1_000_000))
        #expect(shelf.items().count == 1)
    }

    @Test func removeOnlyTouchesTheShelf() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        let a = try file("a.txt", bytes: 1)
        shelf.remove(a)
        #expect(FileManager.default.fileExists(atPath: a.path))
        _ = shelf.keep([a], limitBytes: 1000)
        shelf.removeAll()
        #expect(shelf.items().isEmpty)
    }

    @Test func theStateListsShelfCopiesEvenWithoutFolderAccess() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        let now = Date(timeIntervalSince1970: 100_000)
        _ = shelf.keep([try file("kept.pdf", bytes: 300)], limitBytes: 1000, now: now)
        let folder = RecentFolder(path: "/x", custom: false)
        let old = RecentFile(id: "/x/a.zip", name: "a.zip", size: 1, addedAt: 1, source: .downloads, from: nil)
        var state = RecentFilesState(access: .denied, files: [old], downloads: [], folders: .init(downloads: folder, screenshots: folder))
        state.addShelf(shelf, limitBytes: 1000, expiryHours: 24, now: now.addingTimeInterval(60))
        #expect(state.files.map(\.source) == [.shelf, .downloads])
        #expect(state.shelf == ShelfState(bytes: 300, limitBytes: 1000, expiryHours: 24))
    }

    @Test func aTrashedCopyLeavesNoFolder() throws {
        defer { try? FileManager.default.removeItem(at: base) }
        let kept = shelf.keep([try file("a.txt", bytes: 1)], limitBytes: 1000).kept[0]
        try FileManager.default.removeItem(atPath: kept)
        shelf.trim(limitBytes: 1000, expiryHours: nil)
        #expect((try FileManager.default.contentsOfDirectory(atPath: shelf.root.path)).isEmpty)
    }
}
