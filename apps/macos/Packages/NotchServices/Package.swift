// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NotchServices",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "NotchServices", targets: ["NotchServices"]),
        // Loaded into /usr/bin/perl by MediaService, never linked into the host:
        // the host embeds the built dylib (see MediaBridgeBackend.swift).
        .library(name: "NotchMediaBridge", type: .dynamic, targets: ["NotchMediaBridge"]),
    ],
    targets: [
        .target(name: "NotchServices"),
        .target(name: "NotchMediaBridge", linkerSettings: [.linkedFramework("Foundation")]),
        // Fixtures are read through #filePath, like the bridge-schema case files.
        .testTarget(name: "NotchServicesTests", dependencies: ["NotchServices"], exclude: ["Fixtures"]),
    ],
    swiftLanguageModes: [.v5]
)
