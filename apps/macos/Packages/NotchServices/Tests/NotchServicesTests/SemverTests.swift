import Foundation
import Testing
@testable import NotchServices

/// packages/bridge-schema/test/semver-cases.json: the cases the TS `compareVersions` / `satisfies` run.
private struct SemverCases: Decodable {
    struct Compare: Decodable {
        let a: String, b: String, expected: Int

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            (a, b, expected) = (try c.decode(String.self), try c.decode(String.self), try c.decode(Int.self))
        }
    }

    struct Satisfies: Decodable {
        let version: String, range: String, expected: Bool

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            (version, range, expected) = (try c.decode(String.self), try c.decode(String.self), try c.decode(Bool.self))
        }
    }

    let compare: [Compare]
    let satisfies: [Satisfies]

    static let shared: SemverCases = {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("../../../../packages/bridge-schema/test/semver-cases.json").standardizedFileURL
        return try! JSONDecoder().decode(SemverCases.self, from: Data(contentsOf: file))
    }()
}

@Suite("Semver matches bridge-schema")
struct SemverTests {
    @Test func compare() {
        for c in SemverCases.shared.compare {
            #expect(Semver.compare(c.a, c.b) == c.expected, "\(c.a) vs \(c.b)")
            #expect(Semver.compare(c.b, c.a) == -c.expected, "\(c.b) vs \(c.a)")
        }
    }

    @Test func satisfies() {
        for c in SemverCases.shared.satisfies {
            #expect(Semver.satisfies(c.version, c.range) == c.expected, "\(c.version) in \(c.range)")
        }
    }

    @Test func apiVersionMatchesBridgeSchema() throws {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("../../../../packages/bridge-schema/src/index.ts").standardizedFileURL
        let source = try String(contentsOf: file, encoding: .utf8)
        #expect(source.contains("export const API_VERSION = '\(Semver.apiVersion)'"))
    }
}
