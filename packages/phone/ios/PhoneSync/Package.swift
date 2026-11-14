// swift-tools-version:6.2
import PackageDescription

let package = Package(
  name: "PhoneSync",
  platforms: [.iOS("27.0"), .macOS("27.0")],
  products: [
    .library(name: "PhoneSync", targets: ["PhoneSync"]),
  ],
  dependencies: [
    .package(name: "ArdiaKit", path: "../../../../apps/ios/Packages/ArdiaKit"),
    .package(name: "ArdiaSyncCore", path: "../../../sync"),
  ],
  targets: [
    .target(name: "PhoneSync", dependencies: [.product(name: "ArdiaSync", package: "ArdiaKit")]),
    .testTarget(
      name: "PhoneSyncTests",
      dependencies: [
        "PhoneSync",
        .product(name: "ArdiaSync", package: "ArdiaKit"),
        .product(name: "ArdiaShared", package: "ArdiaKit"),
        .product(name: "ArdiaSyncCore", package: "ArdiaSyncCore"),
      ]
    ),
  ]
)
