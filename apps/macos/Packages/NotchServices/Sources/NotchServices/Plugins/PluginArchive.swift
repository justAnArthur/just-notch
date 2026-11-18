import Compression
import Darwin
import Foundation

/// A `.notchplugin`: a zip of `manifest.json`, `dist/**` and the manifest's icon, as `notch pack` writes it.
///
/// A minimal reader for untrusted archives: the end of central directory and the central directory, stored and
/// deflate entries only (no zip64, no encryption, no symlinks), names that stay inside the plugin, and caps on the
/// size, the file count and each entry's compression ratio. Every entry's size and CRC-32 are checked on read.
public struct PluginArchive {
    public static let maxTotalBytes = 10 * 1024 * 1024
    public static let maxFiles = 500
    public static let maxRatio = 100

    public struct Entry: Equatable {
        public let name: String
        let method: UInt16
        let crc: UInt32
        let compressedSize: Int
        public let size: Int
        let localOffset: Int
    }

    public let entries: [Entry]
    private let bytes: [UInt8]

    public init(_ data: Data) throws {
        bytes = [UInt8](data)
        entries = try Self.centralDirectory(bytes)
    }

    public func read(_ name: String) throws -> Data {
        guard let entry = entries.first(where: { $0.name == name }) else { throw ArchiveError("the archive has no \(name)") }
        return try contents(entry)
    }

    /// Writes the files into `directory` (created here, so it must not exist yet), refusing any name that isn't
    /// `manifest.json`, under `dist/` or `icon`. Files are created exclusively, never through a link; afterwards the
    /// tree is walked again and must hold exactly these regular files.
    public func extract(to directory: URL, icon: String?) throws {
        for entry in entries where !Self.allowed(entry.name, icon: icon) {
            throw ArchiveError("\(entry.name) doesn't belong in a plugin (only manifest.json, dist/ and the icon)")
        }
        guard mkdir(directory.path, 0o755) == 0 else { throw ArchiveError("can't create \(directory.path): \(String(cString: strerror(errno)))") }
        var expected: [String: Int] = [:]
        for entry in entries {
            let isDirectory = entry.name.hasSuffix("/")
            let parts = entry.name.split(separator: "/").map(String.init)
            var path = directory.path
            for part in parts.dropLast(isDirectory ? 0 : 1) {
                path += "/" + part
                try Self.makeDirectory(path)
            }
            if isDirectory { continue }
            try Self.write(try contents(entry), to: path + "/" + parts.last!)
            expected[entry.name] = entry.size
        }
        try Self.verifyTree(directory, expected: expected)
    }

    // MARK: reading

    private static func centralDirectory(_ bytes: [UInt8]) throws -> [Entry] {
        guard bytes.count >= 22 else { throw ArchiveError("not a zip archive") }
        // The end of central directory record: 22 bytes plus a comment of up to 64 KB, at the very end.
        guard let eocd = stride(from: bytes.count - 22, through: max(0, bytes.count - 22 - 0xFFFF), by: -1)
            .first(where: { u32(bytes, $0) == 0x0605_4B50 }) else { throw ArchiveError("not a zip archive") }
        let (disk, cdDisk, onDisk, count) = (u16(bytes, eocd + 4), u16(bytes, eocd + 6), u16(bytes, eocd + 8), u16(bytes, eocd + 10))
        let (cdSize, cdOffset, comment) = (Int(u32(bytes, eocd + 12)), Int(u32(bytes, eocd + 16)), Int(u16(bytes, eocd + 20)))
        guard count != 0xFFFF, cdSize != 0xFFFF_FFFF, cdOffset != 0xFFFF_FFFF else { throw ArchiveError("zip64 archives aren't supported") }
        guard disk == 0, cdDisk == 0, onDisk == count else { throw ArchiveError("multi-disk archives aren't supported") }
        guard eocd + 22 + comment == bytes.count, cdOffset + cdSize == eocd else { throw ArchiveError("the archive is malformed") }
        guard Int(count) <= maxFiles else { throw ArchiveError("more than \(maxFiles) files") }

        var entries: [Entry] = []
        var names = Set<String>()
        var total = 0
        var offset = cdOffset
        for _ in 0..<count {
            guard offset + 46 <= eocd, u32(bytes, offset) == 0x0201_4B50 else { throw ArchiveError("the central directory is malformed") }
            let madeBy = u16(bytes, offset + 4) >> 8
            let (flags, method, crc) = (u16(bytes, offset + 8), u16(bytes, offset + 10), u32(bytes, offset + 16))
            let (compressed, size) = (u32(bytes, offset + 20), u32(bytes, offset + 24))
            let (nameLength, extraLength, commentLength) = (Int(u16(bytes, offset + 28)), Int(u16(bytes, offset + 30)), Int(u16(bytes, offset + 32)))
            let (startDisk, external, local) = (u16(bytes, offset + 34), u32(bytes, offset + 38), u32(bytes, offset + 42))
            let next = offset + 46 + nameLength + extraLength + commentLength
            guard next <= eocd else { throw ArchiveError("the central directory is malformed") }
            guard let name = String(bytes: bytes[(offset + 46)..<(offset + 46 + nameLength)], encoding: .utf8) else {
                throw ArchiveError("an entry's name isn't UTF-8")
            }

            guard flags & 1 == 0 else { throw ArchiveError("encrypted entries aren't supported") }
            guard method == 0 || method == 8 else { throw ArchiveError("\(name): compression method \(method) isn't supported") }
            guard compressed != 0xFFFF_FFFF, size != 0xFFFF_FFFF, local != 0xFFFF_FFFF, startDisk == 0 else {
                throw ArchiveError("zip64 archives aren't supported")
            }
            // Unix mode in the high half of the external attributes: only regular files and directories.
            let type = (external >> 16) & 0o170000
            if madeBy == 3, type != 0, type != 0o100000, type != 0o040000 { throw ArchiveError("\(name) is a link or a special file") }
            try validate(name)
            guard names.insert(name.lowercased()).inserted else { throw ArchiveError("\(name) is in the archive twice") }
            if name.hasSuffix("/") {
                guard size == 0 else { throw ArchiveError("\(name) is malformed") }
            } else if method == 0 {
                guard compressed == size else { throw ArchiveError("\(name) is malformed") }
            } else {
                guard Int(size) <= maxRatio * max(Int(compressed), 1) else { throw ArchiveError("\(name) is compressed suspiciously well") }
            }
            total += Int(size)
            guard total <= maxTotalBytes else { throw ArchiveError("the plugin is larger than \(maxTotalBytes / 1024 / 1024) MB") }

            entries.append(Entry(name: name, method: method, crc: crc, compressedSize: Int(compressed), size: Int(size), localOffset: Int(local)))
            offset = next
        }
        guard offset == eocd else { throw ArchiveError("the central directory is malformed") }
        return entries
    }

    private func contents(_ entry: Entry) throws -> Data {
        guard entry.localOffset + 30 <= bytes.count,
              Self.u32(bytes, entry.localOffset) == 0x0403_4B50 else { throw ArchiveError("\(entry.name): no local header") }
        let nameLength = Int(Self.u16(bytes, entry.localOffset + 26))
        let extraLength = Int(Self.u16(bytes, entry.localOffset + 28))
        let nameStart = entry.localOffset + 30
        guard nameStart + nameLength <= bytes.count,
              Array(bytes[nameStart..<(nameStart + nameLength)]) == Array(entry.name.utf8) else {
            throw ArchiveError("\(entry.name): its local header names another file")
        }
        let start = nameStart + nameLength + extraLength
        guard start + entry.compressedSize <= bytes.count else { throw ArchiveError("\(entry.name) is truncated") }
        let raw = bytes[start..<(start + entry.compressedSize)]

        let output: Data
        if entry.method == 0 {
            output = Data(raw)
        } else {
            output = try Self.inflate(Data(raw), size: entry.size, name: entry.name)
        }
        guard output.count == entry.size else { throw ArchiveError("\(entry.name): wrong size") }
        guard CRC32.checksum(output) == entry.crc else { throw ArchiveError("\(entry.name): checksum mismatch") }
        return output
    }

    /// Raw deflate (Compression's ZLIB is RFC 1951, no header); one byte of room past `size` catches a longer stream.
    private static func inflate(_ input: Data, size: Int, name: String) throws -> Data {
        if size == 0 { return Data() }
        var output = Data(count: size + 1)
        let written = output.withUnsafeMutableBytes { out in
            input.withUnsafeBytes { source in
                compression_decode_buffer(out.bindMemory(to: UInt8.self).baseAddress!, size + 1,
                                          source.bindMemory(to: UInt8.self).baseAddress!, input.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw ArchiveError("\(name) doesn't inflate to its size") }
        return output.prefix(size)
    }

    // MARK: names

    /// Relative, `/`-separated, without empty, `.` or `..` parts, backslashes or NULs.
    static func validate(_ name: String) throws {
        let body = name.hasSuffix("/") ? String(name.dropLast()) : name
        let parts = body.split(separator: "/", omittingEmptySubsequences: false)
        guard !body.isEmpty, !name.hasPrefix("/"), !name.contains("\\"), !name.contains("\0"),
              !parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else {
            throw ArchiveError("\(name.debugDescription) isn't a safe name")
        }
    }

    static func allowed(_ name: String, icon: String?) -> Bool {
        name == "manifest.json" || name == icon || name.hasPrefix("dist/")
    }

    // MARK: writing

    private static func makeDirectory(_ path: String) throws {
        if mkdir(path, 0o755) == 0 { return }
        guard errno == EEXIST else { throw ArchiveError("can't create \(path): \(String(cString: strerror(errno)))") }
        var info = stat()
        guard lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { throw ArchiveError("\(path) isn't a folder") }
    }

    private static func write(_ data: Data, to path: String) throws {
        let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o644)
        guard fd >= 0 else { throw ArchiveError("can't create \(path): \(String(cString: strerror(errno)))") }
        defer { close(fd) }
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let written = Darwin.write(fd, buffer.baseAddress! + offset, buffer.count - offset)
                guard written > 0 else { throw ArchiveError("can't write \(path): \(String(cString: strerror(errno)))") }
                offset += written
            }
        }
    }

    /// The tree under `root` holds exactly `expected` (relative path → size) as regular files, and folders.
    private static func verifyTree(_ root: URL, expected: [String: Int]) throws {
        var found: [String: Int] = [:]
        func walk(_ path: String, _ relative: String) throws {
            guard let names = try? FileManager.default.contentsOfDirectory(atPath: path) else { throw ArchiveError("can't read \(path)") }
            for name in names {
                let child = path + "/" + name, rel = relative.isEmpty ? name : relative + "/" + name
                var info = stat()
                guard lstat(child, &info) == 0 else { throw ArchiveError("can't read \(child)") }
                switch info.st_mode & S_IFMT {
                case S_IFDIR: try walk(child, rel)
                case S_IFREG: found[rel] = Int(info.st_size)
                default: throw ArchiveError("\(rel) isn't a regular file")
                }
            }
        }
        try walk(root.path, "")
        guard found == expected else { throw ArchiveError("the extracted files don't match the archive") }
    }

    private static func u16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
        UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
    }

    private static func u32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
        UInt32(bytes[offset]) | UInt32(bytes[offset + 1]) << 8 | UInt32(bytes[offset + 2]) << 16 | UInt32(bytes[offset + 3]) << 24
    }
}

public struct ArchiveError: LocalizedError, Equatable {
    public let message: String
    init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// CRC-32 (IEEE), as zip stores it.
enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { n in
        (0..<8).reduce(UInt32(n)) { c, _ in c & 1 == 1 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    }

    static func checksum(_ data: Data) -> UInt32 {
        ~data.reduce(~UInt32(0)) { table[Int(($0 ^ UInt32($1)) & 0xFF)] ^ ($0 >> 8) }
    }
}
