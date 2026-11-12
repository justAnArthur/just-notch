// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NotchServices",
    platforms: [.macOS(.v14)],
    products: [.library(name: "NotchServices", targets: ["NotchServices"])],
    targets: [
        .target(name: "NotchServices"),
        .testTarget(name: "NotchServicesTests", dependencies: ["NotchServices"]),
    ]
)
