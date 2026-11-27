import Foundation
import ImageIO
import Vision

/// `screen.grabText`: the system's own region picker (`screencapture -i`), then the text and QR codes in the region,
/// read on this Mac with Vision. The capture is a temporary file, deleted at once; nothing leaves the Mac. The first
/// grab asks for Screen Recording.
@MainActor
public final class ScreenTextService: NotchService {
    public let topics: [String] = []
    public let methods = ["screen.grabText"]
    public weak var sink: ServiceSink?

    private var inFlight = false

    public init() {}

    public func start(topic: String) {}
    public func stop(topic: String) {}
    public func snapshot(topic: String) async -> Data? { nil }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "screen.grabText" else { throw ServiceError("unknown method \(method)") }
        guard !inFlight else { throw ServiceError("already picking a region") }
        inFlight = true
        defer { inFlight = false }

        let file = FileManager.default.temporaryDirectory.appendingPathComponent("notch-grab-\(UUID().uuidString).png")
        defer { try? FileManager.default.removeItem(at: file) }
        guard await Self.capture(to: file),
              let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return jsonNull } // Escape or a click without a region: nothing grabbed.
        let result = try await Task.detached { try Self.read(image) }.value
        return result.json()
    }

    /// Runs `screencapture -i -x` (interactive region, no sound); true when it wrote a picture.
    private static func capture(to file: URL) async -> Bool {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            process.arguments = ["-i", "-x", file.path]
            process.terminationHandler = { _ in
                continuation.resume(returning: FileManager.default.fileExists(atPath: file.path))
            }
            do { try process.run() } catch { continuation.resume(returning: false) }
        }
    }

    nonisolated static func read(_ image: CGImage) throws -> GrabbedText {
        let text = VNRecognizeTextRequest()
        text.recognitionLevel = .accurate
        text.usesLanguageCorrection = true
        text.automaticallyDetectsLanguage = true
        let codes = VNDetectBarcodesRequest()
        codes.symbologies = [.qr, .aztec, .dataMatrix, .pdf417]
        try VNImageRequestHandler(cgImage: image).perform([text, codes])

        let lines = (text.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        let payloads = (codes.results ?? []).compactMap(\.payloadStringValue)
        var seen = Set<String>()
        return GrabbedText(text: lines.joined(separator: "\n"), codes: payloads.filter { seen.insert($0).inserted })
    }
}

/// bridge-schema `GrabbedText`.
public struct GrabbedText: Codable, Equatable, Sendable {
    public var text: String
    public var codes: [String]
}
