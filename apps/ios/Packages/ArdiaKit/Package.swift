// swift-tools-version:6.2
import PackageDescription

let package = Package(
  name: "ArdiaKit",
  platforms: [.iOS("27.0"), .macOS("27.0")],
  products: [
    .library(name: "ArdiaShared", targets: ["ArdiaShared"]),
    .library(name: "ArdiaSync", targets: ["ArdiaSync"]),
    .library(name: "ArdiaBrowser", targets: ["ArdiaBrowser"]),
    .library(name: "ArdiaIntelligence", targets: ["ArdiaIntelligence"]),
    .library(name: "ArdiaDesign", targets: ["ArdiaDesign"]),
  ],
  dependencies: [
    .package(name: "ArdiaSyncCore", path: "../../../../packages/sync"),
  ],
  targets: [
    .target(name: "ArdiaShared", resources: [.copy("Scripts")]),
    .target(name: "ArdiaSync", dependencies: ["ArdiaShared", .product(name: "ArdiaSyncCore", package: "ArdiaSyncCore")]),
    .target(name: "ArdiaBrowser", dependencies: ["ArdiaShared", "ArdiaSync"]),
    .target(name: "ArdiaIntelligence", dependencies: ["ArdiaBrowser"]),
    .target(name: "ArdiaDesign", dependencies: ["ArdiaBrowser"]),
    .testTarget(name: "ArdiaSharedTests", dependencies: ["ArdiaShared"]),
    .testTarget(name: "ArdiaSyncTests", dependencies: ["ArdiaSync", .product(name: "ArdiaSyncCore", package: "ArdiaSyncCore")]),
    .testTarget(name: "ArdiaBrowserTests", dependencies: ["ArdiaBrowser"]),
    .testTarget(name: "ArdiaIntelligenceTests", dependencies: ["ArdiaIntelligence"]),
    .testTarget(name: "ArdiaDesignTests", dependencies: ["ArdiaDesign"]),
  ]
)
