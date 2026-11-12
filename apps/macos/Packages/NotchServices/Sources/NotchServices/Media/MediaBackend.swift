import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Now-playing info as a backend reports it, before artwork is encoded.
/// Also the JSON line format of the NotchMediaBridge helper.
struct RawNowPlaying: Decodable, Equatable {
    var title: String
    var artist: String
    var album: String
    var durationS: Double
    var positionS: Double
    var rate: Double
    var playing: Bool
    var timestamp: Double
    var bundleId: String?
    /// New artwork bytes; nil means unchanged unless `artworkCleared`.
    var artwork: Data?
    var artworkCleared: Bool?
}

@MainActor
protocol MediaBackend: AnyObject {
    var name: String { get }
    /// nil: nothing is playing.
    var onChange: ((RawNowPlaying?) -> Void)? { get set }
    /// The backend stopped working (helper died); the service picks another.
    var onFailure: (() -> Void)? { get set }
    func start()
    func stop()
    func send(_ command: MediaCommand)
}

/// Encodes artwork as a JPEG `data:` URL, at most 300 px on its long side.
func artworkDataURL(_ data: Data, maxPixels: Int = 300) -> String? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return "data:image/jpeg;base64," + (output as Data).base64EncodedString()
}
