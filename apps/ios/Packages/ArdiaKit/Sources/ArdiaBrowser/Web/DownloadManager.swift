import Foundation
import WebKit

public enum DownloadOutcome: Equatable, Sendable {
  case finished(URL)
  case failed(fileName: String)
}

public struct DownloadStart: Sendable {
  public let id: UUID
  public let url: URL?
  public let fileName: String
  public let mimeType: String?
  public let contentLength: Int64?
}

public struct DownloadProgressInfo: Sendable, Equatable {
  public let id: UUID
  public let fileName: String
  public let bytes: Int64
  public let total: Int64?
  public let isQueued: Bool

  public var fraction: Double? { total.flatMap { $0 > 0 ? Double(bytes) / Double($0) : nil } }
}

@MainActor
public final class DownloadManager {
  public let directory: URL
  public var onOutcome: (@MainActor (DownloadOutcome) -> Void)?
  public var onStart: (@MainActor (DownloadStart, WKWebView?) -> Void)?
  public var onProgress: (@MainActor ([DownloadProgressInfo]) -> Void)?

  private struct Active {
    let id: UUID
    let download: WKDownload
    var fileName: String
    var destination: URL?
    var observation: NSKeyValueObservation?
  }

  private var active: [ObjectIdentifier: Active] = [:]
  private var order: [ObjectIdentifier] = []
  private var delegate: DownloadDelegate?

  public init(directory: URL = URL.documentsDirectory.appending(path: "Downloads", directoryHint: .isDirectory)) {
    self.directory = directory
  }

  public var progress: [DownloadProgressInfo] {
    order.compactMap { key in
      guard let entry = active[key] else { return nil }
      let progress = entry.download.progress
      let total = progress.totalUnitCount > 0 ? progress.totalUnitCount : nil
      return DownloadProgressInfo(id: entry.id, fileName: entry.fileName, bytes: max(progress.completedUnitCount, 0), total: total, isQueued: entry.destination == nil)
    }
  }

  public func cancel(_ id: UUID) {
    guard let entry = active.values.first(where: { $0.id == id }) else { return }
    entry.download.cancel { _ in }
    failed(entry.download)
  }

  func track(_ download: WKDownload) {
    if delegate == nil { delegate = DownloadDelegate(manager: self) }
    download.delegate = delegate
    let key = ObjectIdentifier(download)
    active[key] = Active(id: UUID(), download: download, fileName: download.originalRequest?.url?.lastPathComponent ?? "")
    order.append(key)
    reportProgress()
  }

  func destination(for download: WKDownload, response: URLResponse, suggestedFilename: String) -> URL? {
    let key = ObjectIdentifier(download)
    guard let entry = active[key] else { return nil }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    } catch {
      failed(download)
      return nil
    }
    let url = Self.uniqueURL(in: directory, for: suggestedFilename)
    active[key]?.fileName = url.lastPathComponent
    active[key]?.destination = url
    active[key]?.observation = download.progress.observe(\.completedUnitCount, options: []) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.reportProgress() }
    }
    let length = response.expectedContentLength
    onStart?(
      DownloadStart(id: entry.id, url: download.originalRequest?.url ?? response.url, fileName: url.lastPathComponent, mimeType: response.mimeType, contentLength: length >= 0 ? length : nil),
      download.webView
    )
    reportProgress()
    return url
  }

  func finished(_ download: WKDownload) {
    guard let entry = remove(download) else { return }
    if let destination = entry.destination {
      onOutcome?(.finished(destination))
    } else {
      onOutcome?(.failed(fileName: entry.fileName))
    }
  }

  func failed(_ download: WKDownload) {
    guard let entry = remove(download) else { return }
    onOutcome?(.failed(fileName: entry.fileName))
  }

  private func remove(_ download: WKDownload) -> Active? {
    let key = ObjectIdentifier(download)
    guard let entry = active.removeValue(forKey: key) else { return nil }
    order.removeAll { $0 == key }
    entry.observation?.invalidate()
    reportProgress()
    return entry
  }

  private func reportProgress() {
    onProgress?(progress)
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
    manager?.destination(for: download, response: response, suggestedFilename: suggestedFilename)
  }

  func downloadDidFinish(_ download: WKDownload) {
    manager?.finished(download)
  }

  func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
    manager?.failed(download)
  }
}
