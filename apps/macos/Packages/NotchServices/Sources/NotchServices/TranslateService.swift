import Foundation
import NaturalLanguage
import Translation

/// `text.translate`: Apple's on-device translation (macOS 26), for language pairs the Mac has downloaded. Nothing is
/// sent anywhere. The source language is detected; the target defaults to the user's language, or English when the
/// text is already in it.
@MainActor
public final class TranslateService: NotchService {
    public let topics: [String] = []
    public let methods = ["text.translate"]
    public weak var sink: ServiceSink?

    public init() {}

    public func start(topic: String) {}
    public func stop(topic: String) {}
    public func snapshot(topic: String) async -> Data? { nil }

    public func handle(method: String, params: Data) async throws -> Data? {
        guard method == "text.translate" else { throw ServiceError("unknown method \(method)") }
        struct Params: Decodable {
            var text: String
            var to: String?
        }
        let params = try decode(Params.self, params)
        let text = String(params.text.prefix(5000)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ServiceError("nothing to translate") }
        guard #available(macOS 26.0, *) else { throw ServiceError("Translation needs macOS 26 or later") }

        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        guard let detected = recognizer.dominantLanguage else { throw ServiceError("couldn't tell which language that is") }
        let source = Locale.Language(identifier: detected.rawValue)
        let target = Self.target(for: source, requested: params.to)
        guard target.languageCode != source.languageCode else {
            return Translated(text: text, from: Self.code(source), to: Self.code(target)).json()
        }

        switch await LanguageAvailability().status(from: source, to: target) {
        case .installed:
            let session = TranslationSession(installedSource: source, target: target)
            let response = try await session.translate(text)
            return Translated(text: response.targetText, from: Self.code(source), to: Self.code(target)).json()
        case .supported:
            throw ServiceError("Download \(Self.name(source)) and \(Self.name(target)) in System Settings › General › Language & Region › Translation Languages")
        case .unsupported:
            throw ServiceError("Your Mac can't translate \(Self.name(source)) to \(Self.name(target))")
        @unknown default:
            throw ServiceError("Your Mac can't translate this")
        }
    }

    /// The requested language, else the user's own, else English when the text is already in the user's language.
    static func target(for source: Locale.Language, requested: String?) -> Locale.Language {
        if let requested, !requested.isEmpty { return Locale.Language(identifier: requested) }
        let mine = Locale.preferredLanguages.first.map(Locale.Language.init(identifier:)) ?? Locale.current.language
        return mine.languageCode == source.languageCode ? Locale.Language(identifier: "en") : mine
    }

    static func code(_ language: Locale.Language) -> String {
        language.languageCode?.identifier ?? language.minimalIdentifier
    }

    static func name(_ language: Locale.Language) -> String {
        Locale.current.localizedString(forLanguageCode: code(language)) ?? code(language)
    }
}

/// bridge-schema `Translated`.
public struct Translated: Codable, Equatable, Sendable {
    public var text: String
    public var from: String
    public var to: String
}
