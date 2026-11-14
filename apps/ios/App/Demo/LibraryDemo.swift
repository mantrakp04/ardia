import ArdiaBrowser
import Foundation
import OSLog
import UIKit

enum LibraryDemo {
  struct File {
    var name: String
    var source: String
    var minutesAgo: Double
    var bytes: Int64
    var expected: Int64?
    var state: DownloadState
  }

  static let files: [File] = [
    File(name: "Swift-6.3-Toolchain.pkg", source: "https://download.swift.org/swift-6.3-release/xcode/swift-6.3-RELEASE-osx.pkg", minutesAgo: 1, bytes: 412_000_000, expected: 896_000_000, state: .downloading),
    File(name: "Lisbon-City-Guide.pdf", source: "https://www.visitlisboa.com/guides/lisbon-city-guide.pdf", minutesAgo: 25, bytes: 2_480_000, expected: nil, state: .finished),
    File(name: "Pasteis-de-Nata.jpg", source: "https://upload.wikimedia.org/wikipedia/commons/pasteis.jpg", minutesAgo: 70, bytes: 1_140_000, expected: nil, state: .finished),
    File(name: "Concert-Tickets.pkpass", source: "https://tickets.example.com/order/4418/pass", minutesAgo: 140, bytes: 61_000, expected: 240_000, state: .failed(.connection)),
    File(name: "Podcast-Episode-112.mp3", source: "https://cdn.example.fm/episodes/112.mp3", minutesAgo: 60 * 26, bytes: 18_000_000, expected: 54_000_000, state: .cancelled),
    File(name: "Tram-28-Timetable.pdf", source: "https://www.carris.pt/timetables/28.pdf", minutesAgo: 60 * 27, bytes: 380_000, expected: nil, state: .finished),
  ]

  static let permissions: [(host: String, permissions: Set<SitePermission>)] = [
    ("meet.google.com", [.camera, .microphone]),
    ("maps.apple.com", [.location]),
    ("music.youtube.com", [.microphone]),
  ]

  @MainActor
  static func seed(_ app: AppModel) {
    for grant in permissions { app.preferences.grant(grant.permissions, host: grant.host) }
    let downloads = app.web.downloads
    let now = Date.now
    let items = files.map { file in
      let started = now.addingTimeInterval(-file.minutesAgo * 60)
      if file.state == .finished { writeSample(named: file.name, in: downloads.directory) }
      return DownloadItem(
        id: UUID(),
        fileName: file.name,
        sourceURL: URL(string: file.source),
        startedAt: started,
        finishedAt: file.state == .downloading ? nil : started.addingTimeInterval(20),
        receivedBytes: file.bytes,
        expectedBytes: file.state == .finished ? file.bytes : file.expected,
        state: file.state,
        isPrivate: false
      )
    }
    downloads.add(items)
  }

  @MainActor
  static func apply(to app: AppModel, value: (String) -> String?, delay: Double) {
    if let section = value("-ArdiaOpenSheet").flatMap(LibrarySection.init(rawValue:)) {
      Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(600))
        app.openLibrary(section)
      }
    }
    guard let target = value("-ArdiaPrint") else { return }
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(delay + 3))
      switch target {
      case "reader":
        guard let id = app.tabs.selectedTabID else { return }
        await app.printReader(of: id)
      default:
        app.printCurrentPage()
      }
    }
  }

  private static func writeSample(named name: String, in directory: URL) {
    let url = directory.appending(path: name)
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try sampleData(for: name).write(to: url, options: .atomic)
    } catch {
      Logger(subsystem: "com.ardia.browser.ios", category: "demo").error("Couldn't write a demo download: \(error.localizedDescription, privacy: .public)")
    }
  }

  private static func sampleData(for name: String) -> Data {
    let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
    if name.hasSuffix(".pdf") {
      return UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
        context.beginPage()
        let title = (name as NSString).deletingPathExtension.replacingOccurrences(of: "-", with: " ")
        title.draw(at: CGPoint(x: 72, y: 72), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 28)])
      }
    }
    let image = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 400)).image { context in
      UIColor.systemOrange.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 600, height: 400))
    }
    return image.jpegData(compressionQuality: 0.8) ?? Data()
  }
}
