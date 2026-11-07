import Foundation
import Observation
import WebKit

@MainActor
@Observable
public final class DownloadItem: Identifiable {
  public enum State: Equatable {
    case downloading
    case finished(URL)
    case failed(String)
    case cancelled
  }

  public let id = UUID()
  public let sourceURL: URL?
  public internal(set) var fileName: String
  public internal(set) var progress = 0.0
  public internal(set) var totalBytes: Int64 = 0
  public internal(set) var state: State = .downloading
  public let started: Date

  @ObservationIgnored var download: WKDownload?
  @ObservationIgnored var destination: URL?
  @ObservationIgnored var resumeData: Data?
  @ObservationIgnored var observation: NSKeyValueObservation?

  init(sourceURL: URL?, fileName: String, started: Date) {
    self.sourceURL = sourceURL
    self.fileName = fileName
    self.started = started
  }
}

@MainActor
@Observable
public final class DownloadManager {
  public private(set) var items: [DownloadItem] = []
  public let directory: URL

  @ObservationIgnored private var delegate: DownloadDelegate?

  public init(directory: URL = URL.documentsDirectory.appending(path: "Downloads", directoryHint: .isDirectory)) {
    self.directory = directory
  }

  public var activeCount: Int { items.count { $0.state == .downloading } }

  func track(_ download: WKDownload) {
    let item = DownloadItem(sourceURL: download.originalRequest?.url, fileName: download.originalRequest?.url?.lastPathComponent ?? "", started: .now)
    item.download = download
    if delegate == nil { delegate = DownloadDelegate(manager: self) }
    download.delegate = delegate
    item.observation = download.progress.observe(\.fractionCompleted, options: [.new]) { [weak item] progress, _ in
      let fraction = progress.fractionCompleted
      let total = progress.totalUnitCount
      Task { @MainActor in
        guard let item else { return }
        let whole = (fraction * 100).rounded(.down) / 100
        if whole != item.progress { item.progress = whole }
        if total > 0, total != item.totalBytes { item.totalBytes = total }
      }
    }
    items.insert(item, at: 0)
  }

  public func cancel(_ item: DownloadItem) {
    guard item.state == .downloading, let download = item.download else { return }
    download.cancel { [weak item] data in
      Task { @MainActor in item?.resumeData = data }
    }
    finish(item, .cancelled)
  }

  public func remove(_ item: DownloadItem) {
    if item.state == .downloading { cancel(item) }
    items.removeAll { $0.id == item.id }
  }

  public func clearFinished() {
    items.removeAll { $0.state != .downloading }
  }

  func item(for download: WKDownload) -> DownloadItem? {
    items.first { $0.download === download }
  }

  func destination(for item: DownloadItem, suggestedFilename: String) -> URL? {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    } catch {
      return nil
    }
    let url = Self.uniqueURL(in: directory, for: suggestedFilename)
    item.fileName = url.lastPathComponent
    item.destination = url
    return url
  }

  func finish(_ item: DownloadItem, _ state: DownloadItem.State) {
    guard item.state == .downloading else { return }
    item.state = state
    if case .finished = state { item.progress = 1 }
    item.observation?.invalidate()
    item.observation = nil
    item.download = nil
  }

  nonisolated static func uniqueURL(in directory: URL, for suggested: String) -> URL {
    let cleaned = suggested
      .replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
    let name = cleaned.isEmpty ? String(localized: "Download") : cleaned
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    var candidate = directory.appending(path: name)
    var counter = 2
    while FileManager.default.fileExists(atPath: candidate.path(percentEncoded: false)) {
      let numbered = "\(base) \(counter)"
      candidate = directory.appending(path: ext.isEmpty ? numbered : "\(numbered).\(ext)")
      counter += 1
    }
    return candidate
  }
}

@MainActor
final class DownloadDelegate: NSObject, WKDownloadDelegate {
  weak var manager: DownloadManager?

  init(manager: DownloadManager) {
    self.manager = manager
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
    guard let manager, let item = manager.item(for: download) else { return nil }
    if let url = manager.destination(for: item, suggestedFilename: suggestedFilename) { return url }
    manager.finish(item, .failed(String(localized: "There isn’t enough space to save this file.")))
    return nil
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let manager, let item = manager.item(for: download), let destination = item.destination else { return }
    manager.finish(item, .finished(destination))
  }

  func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
    guard let manager, let item = manager.item(for: download) else { return }
    item.resumeData = resumeData
    let nsError = error as NSError
    let message = nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorNotConnectedToInternet
      ? String(localized: "The download stopped because your iPhone isn’t connected to the internet.")
      : String(localized: "The download couldn’t be completed.")
    manager.finish(item, .failed(message))
  }
}
