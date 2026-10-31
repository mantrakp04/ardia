// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArdiaUpdaterCore",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "ArdiaUpdaterCore", targets: ["ArdiaUpdaterCore"]),
  ],
  targets: [
    .target(name: "ArdiaMenuCore", path: "ios/MenuCore"),
    .testTarget(name: "ArdiaMenuCoreTests", dependencies: ["ArdiaMenuCore"], path: "menu-tests"),
    .target(name: "ArdiaUpdaterCore", path: "ios/UpdaterCore"),
    .testTarget(name: "ArdiaUpdaterCoreTests", dependencies: ["ArdiaUpdaterCore"], path: "tests"),
  ]
)
