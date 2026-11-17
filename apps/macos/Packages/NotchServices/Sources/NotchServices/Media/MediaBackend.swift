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
    /// MediaRemote's raw values, nil when the player leaves them out of its now-playing info.
    var shuffleMode: Int?
    var repeatMode: Int?
    var isLiked: Bool?
    var supportsIsLiked: Bool?
}

/// MediaRemote's shuffle and repeat modes, as `MRMediaRemoteCopyShuffleModeDescription` /
/// `…RepeatModeDescription` name them (checked on macOS 26): shuffle 1 Off, 2 Albums, 3 Songs;
/// repeat 1 None, 2 One, 3 All; 0 is unknown.
enum MediaRemoteMode {
    static func shuffle(_ mode: Int?) -> Bool? {
        switch mode {
        case 1: false
        case 2, 3: true
        default: nil
        }
    }

    static func `repeat`(_ mode: Int?) -> MediaState.Repeat? {
        switch mode {
        case 1: .off
        case 2: .one
        case 3: .all
        default: nil
        }
    }

    static func code(shuffle: Bool) -> Int { shuffle ? 3 : 1 }

    static func code(repeat mode: MediaState.Repeat) -> Int {
        switch mode {
        case .off: 1
        case .one: 2
        case .all: 3
        }
    }

    /// Players that support likes say so; a missing `IsLiked` then means not liked.
    static func liked(_ isLiked: Bool?, supported: Bool?) -> Bool? {
        supported == false ? nil : isLiked ?? (supported == true ? false : nil)
    }

    /// `MRMediaRemoteSendCommand` codes and option keys (`MRMediaRemoteCopyCommandDescription`, macOS 26).
    static let likeTrack: Int32 = 21
    static let setRepeatMode: Int32 = 25
    static let setShuffleMode: Int32 = 26

    static func options(_ command: MediaCommand) -> (code: Int32, options: [String: Any])? {
        switch command {
        case .shuffle(let on): (setShuffleMode, ["kMRMediaRemoteOptionShuffleMode": code(shuffle: on)])
        case .repeat(let mode): (setRepeatMode, ["kMRMediaRemoteOptionRepeatMode": code(repeat: mode)])
        case .like(let liked): (likeTrack, ["kMRMediaRemoteOptionIsNegative": !liked])
        default: nil
        }
    }
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
