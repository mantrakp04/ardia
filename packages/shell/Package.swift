// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArdiaUpdaterCore",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "ArdiaUpdaterCore", targets: ["ArdiaUpdaterCore"]),
    .library(name: "ArdiaTranslateCore", targets: ["ArdiaTranslateCore"]),
    .library(name: "ArdiaReportCore", targets: ["ArdiaReportCore"]),
  ],
  targets: [
    .target(name: "ArdiaUpdaterCore", path: "ios/UpdaterCore"),
    .testTarget(name: "ArdiaUpdaterCoreTests", dependencies: ["ArdiaUpdaterCore"], path: "tests"),
    .target(name: "ArdiaTranslateCore", path: "ios/TranslateCore"),
    .testTarget(name: "ArdiaTranslateCoreTests", dependencies: ["ArdiaTranslateCore"], path: "translate-tests"),
    .target(name: "ArdiaReportCore", path: "ios/ReportCore"),
    .testTarget(name: "ArdiaReportCoreTests", dependencies: ["ArdiaReportCore"], path: "report-tests"),
  ]
)
