// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "CrossCheck",
  platforms: [.macOS(.v14)],
  dependencies: [
    .package(name: "ArdiaSyncCore", path: "../../../../packages/sync"),
  ],
  targets: [
    .executableTarget(name: "CrossCheck", dependencies: [.product(name: "ArdiaSyncCore", package: "ArdiaSyncCore")]),
  ]
)
