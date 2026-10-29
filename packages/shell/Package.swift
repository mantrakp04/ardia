// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArdiaUpdaterCore",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "ArdiaUpdaterCore", targets: ["ArdiaUpdaterCore"]),
  ],
  targets: [
    .target(name: "ArdiaUpdaterCore", path: "ios/UpdaterCore"),
    .testTarget(name: "ArdiaUpdaterCoreTests", dependencies: ["ArdiaUpdaterCore"], path: "tests"),
  ]
)
