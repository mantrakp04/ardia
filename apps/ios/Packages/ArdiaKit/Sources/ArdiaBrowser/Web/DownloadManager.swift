import Foundation
import WebKit

public enum DownloadOutcome: Equatable, Sendable {
  case finished(URL)
  case failed(fileName: String)
}

@MainActor
public final class DownloadManager {
  public let directory: URL
  public var onOutcome: (@MainActor (DownloadOutcome) -> Void)?

  private struct Active {
    let download: WKDownload
    var fileName: String
    var destination: URL?
  }

  private var active: [ObjectIdentifier: Active] = [:]
  private var delegate: DownloadDelegate?

  public init(directory: URL = URL.documentsDirectory.appending(path: "Downloads", directoryHint: .isDirectory)) {
    self.directory = directory
  }

  func track(_ download: WKDownload) {
    if delegate == nil { delegate = DownloadDelegate(manager: self) }
    download.delegate = delegate
    active[ObjectIdentifier(download)] = Active(download: download, fileName: download.originalRequest?.url?.lastPathComponent ?? "")
  }

  func destination(for download: WKDownload, suggestedFilename: String) -> URL? {
    let key = ObjectIdentifier(download)
    guard active[key] != nil else { return nil }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    } catch {
      failed(download)
      return nil
    }
    let url = Self.uniqueURL(in: directory, for: suggestedFilename)
    active[key]?.fileName = url.lastPathComponent
    active[key]?.destination = url
    return url
  }

  func finished(_ download: WKDownload) {
    guard let entry = active.removeValue(forKey: ObjectIdentifier(download)) else { return }
    if let destination = entry.destination {
      onOutcome?(.finished(destination))
    } else {
      onOutcome?(.failed(fileName: entry.fileName))
    }
  }

  func failed(_ download: WKDownload) {
    guard let entry = active.removeValue(forKey: ObjectIdentifier(download)) else { return }
    onOutcome?(.failed(fileName: entry.fileName))
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
    manager?.destination(for: download, suggestedFilename: suggestedFilename)
  }

  func downloadDidFinish(_ download: WKDownload) {
    manager?.finished(download)
  }

  func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
    manager?.failed(download)
  }
}
