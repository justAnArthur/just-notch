import Compression
import Foundation
import Testing
@testable import NotchServices

/// A zip writer for hand-crafted archives: each entry stored or deflated, with a chosen Unix mode.
private struct ZipEntry {
    var name: String
    var data: Data
    var deflate = false
    /// Unix mode in the external attributes (made by Unix); nil leaves them at 0.
    var mode: UInt32?
}

private func zip(_ entries: [ZipEntry]) -> Data {
    var out = Data(), central = Data()
    func le16(_ v: Int, _ d: inout Data) { d.append(contentsOf: [UInt8(v & 0xFF), UInt8(v >> 8 & 0xFF)]) }
    func le32(_ v: UInt32, _ d: inout Data) { for i in 0..<4 { d.append(UInt8(v >> (8 * UInt32(i)) & 0xFF)) } }
    for entry in entries {
        let body = entry.deflate ? deflate(entry.data) : entry.data
        let crc = CRC32.checksum(entry.data), name = Data(entry.name.utf8), offset = UInt32(out.count)
        le32(0x0403_4B50, &out); le16(20, &out); le16(0, &out); le16(entry.deflate ? 8 : 0, &out); le16(0, &out); le16(0x21, &out)
        le32(crc, &out); le32(UInt32(body.count), &out); le32(UInt32(entry.data.count), &out); le16(name.count, &out); le16(0, &out)
        out.append(name); out.append(body)

        le32(0x0201_4B50, &central); le16(entry.mode == nil ? 20 : 0x0314, &central); le16(20, &central); le16(0, &central)
        le16(entry.deflate ? 8 : 0, &central); le16(0, &central); le16(0x21, &central)
        le32(crc, &central); le32(UInt32(body.count), &central); le32(UInt32(entry.data.count), &central)
        le16(name.count, &central); le16(0, &central); le16(0, &central); le16(0, &central); le16(0, &central)
        le32((entry.mode ?? 0) << 16, &central); le32(offset, &central); central.append(name)
    }
    let cdOffset = out.count
    out.append(central)
    le32(0x0605_4B50, &out); le16(0, &out); le16(0, &out); le16(entries.count, &out); le16(entries.count, &out)
    le32(UInt32(central.count), &out); le32(UInt32(cdOffset), &out); le16(0, &out)
    return out
}

private func deflate(_ data: Data) -> Data {
    var output = Data(count: data.count + 1024)
    let written = output.withUnsafeMutableBytes { out in
        data.withUnsafeBytes { source in
            compression_encode_buffer(out.bindMemory(to: UInt8.self).baseAddress!, data.count + 1024,
                                      source.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
        }
    }
    return output.prefix(written)
}

private let manifest = ZipEntry(name: "manifest.json", data: Data(#"{"id":"demo"}"#.utf8))
private let entry = ZipEntry(name: "dist/index.js", data: Data("export default {}\n".utf8), deflate: true)

private func temporaryDirectory() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("archive-tests-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func rejects(_ entries: [ZipEntry], icon: String? = nil, _ message: String, sourceLocation: SourceLocation = #_sourceLocation) {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    do {
        try PluginArchive(zip(entries)).extract(to: root.appendingPathComponent("out"), icon: icon)
        Issue.record("extracted; expected “\(message)”", sourceLocation: sourceLocation)
    } catch {
        #expect(error.localizedDescription.contains(message), "\(error.localizedDescription)", sourceLocation: sourceLocation)
    }
}

@Suite("PluginArchive")
struct PluginArchiveTests {
    @Test func readsWhatNotchPackWrites() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/github-0.1.0.notchplugin")
        let archive = try PluginArchive(Data(contentsOf: file))
        #expect(archive.entries.map(\.name) == ["dist/index.css", "dist/index.js", "dist/index.js.map", "manifest.json"])
        let manifest = try JSONSerialization.jsonObject(with: archive.read("manifest.json")) as? [String: Any]
        #expect(manifest?["id"] as? String == "github")

        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try archive.extract(to: root.appendingPathComponent("github"), icon: nil)
        let js = try String(contentsOf: root.appendingPathComponent("github/dist/index.js"), encoding: .utf8)
        #expect(js.count == 17416 || js.utf8.count == 17416)
    }

    @Test func extractsStoredDeflatedAndTheIcon() throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let icon = ZipEntry(name: "icon.svg", data: Data("<svg/>".utf8))
        let folder = ZipEntry(name: "dist/", data: Data())
        try PluginArchive(zip([manifest, folder, entry, icon])).extract(to: root.appendingPathComponent("out"), icon: "icon.svg")
        #expect(try Data(contentsOf: root.appendingPathComponent("out/dist/index.js")) == entry.data)
        #expect(FileManager.default.fileExists(atPath: root.appendingPathComponent("out/icon.svg").path))
    }

    @Test func refusesUnsafeNames() {
        for name in ["/etc/passwd", "../evil.js", "dist/../../evil.js", "dist/./a.js", "dist\\a.js", "dist/a\0.js", "dist//a.js", ""] {
            rejects([manifest, ZipEntry(name: name, data: Data("x".utf8))], "isn't a safe name")
        }
    }

    @Test func refusesFilesOutsideThePlugin() {
        rejects([manifest, ZipEntry(name: "src/index.ts", data: Data("x".utf8))], "doesn't belong in a plugin")
        rejects([manifest, ZipEntry(name: "icon.png", data: Data("x".utf8))], icon: "logo.png", "doesn't belong in a plugin")
        rejects([manifest, ZipEntry(name: "dist", data: Data("x".utf8))], "doesn't belong in a plugin")
    }

    @Test func refusesDuplicatesAndLinks() {
        rejects([manifest, entry, entry], "twice")
        rejects([manifest, entry, ZipEntry(name: "DIST/index.js", data: Data("x".utf8))], "twice")
        rejects([manifest, ZipEntry(name: "dist/link.js", data: Data("/etc/passwd".utf8), mode: 0o120777)], "link")
    }

    @Test func refusesBombsAndTooManyFiles() {
        rejects([manifest, ZipEntry(name: "dist/zeros.js", data: Data(count: 2 * 1024 * 1024), deflate: true)], "suspiciously")
        let big = (0..<3).map { ZipEntry(name: "dist/\($0).bin", data: Data((0..<(4 * 1024 * 1024)).map { UInt8(truncatingIfNeeded: $0 &* 2654435761 >> 13) })) }
        rejects([manifest] + big, "larger than")
        rejects([manifest] + (0...PluginArchive.maxFiles).map { ZipEntry(name: "dist/\($0).js", data: Data()) }, "more than")
    }

    @Test func refusesCorruptArchives() throws {
        #expect(throws: ArchiveError.self) { try PluginArchive(Data("not a zip".utf8)) }
        var data = zip([manifest, entry])
        data[data.count - 30] ^= 0xFF // inside the central directory
        #expect(throws: (any Error).self) { try PluginArchive(data).read("dist/index.js") }
        var flipped = zip([manifest, ZipEntry(name: "dist/a.js", data: Data("hello".utf8))])
        flipped[30 + "manifest.json".utf8.count + 13 + 30 + "dist/a.js".utf8.count] ^= 0x01 // a stored byte: CRC catches it
        #expect(throws: ArchiveError.self) { try PluginArchive(flipped).read("dist/a.js") }
    }

    @Test func refusesAnExistingDestination() throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(throws: ArchiveError.self) { try PluginArchive(zip([manifest, entry])).extract(to: root, icon: nil) }
    }
}
