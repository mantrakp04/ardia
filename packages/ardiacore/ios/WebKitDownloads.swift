import AppKit
import WebKit

final class WebKitDownloads: NSObject, WKDownloadDelegate {
  private enum Phase {
    case running, pausing, paused, resuming, finished, failed, cancelled

    var isDone: Bool { self == .finished || self == .failed || self == .cancelled }
    var isPaused: Bool { self == .pausing || self == .paused || self == .resuming }
    var state: String {
      switch self {
      case .running, .pausing, .paused, .resuming: "downloading"
      case .finished: "finished"
      case .failed: "failed"
      case .cancelled: "cancelled"
      }
    }
  }

  static let idPrefix = "wk-download-"

  private struct FileIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
  }

  private final class Item {
    let uuid = UUID().uuidString
    var id: String { WebKitDownloads.idPrefix + uuid }
    var download: WKDownload?
    weak var webView: WKWebView?
    let url: String
    let profile: String
    var request: URLRequest?
    var phase = Phase.running
    var filename = ""
    var path = ""
    var final: URL?
    var replaces: FileIdentity?
    var staging: URL?
    var received: Int64 = 0
    var total: Int64 = 0
    var speed: Double = 0
    var mimeType = ""
    var resumeData: Data?
    var progress: NSKeyValueObservation?
    var sampledAt = Date()
    var sampledBytes: Int64 = 0
    var reportedAt = Date.distantPast

    init(url: String, profile: String) {
      self.url = url
      self.profile = profile
    }

    var stagingFile: URL? { staging.map { $0.appendingPathComponent(filename.isEmpty ? "download" : filename) } }
  }

  private var items: [String: Item] = [:]
  private var byDownload: [ObjectIdentifier: String] = [:]
  private let fallbackFolder: URL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")

  private func resolveDestination(for profile: String, completion: @escaping (URL, Bool) -> Void) {
    ArdiaEngineBridge.call("ac_downloads_settings", profile: ArdiaHost.baseProfile(of: profile), args: nil) { [weak self] json in
      let parsed = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
      let folder = (parsed?["folder"] as? String).flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0, isDirectory: true) }
      let ask = parsed?["askWhereToSave"] as? Bool ?? (folder == nil)
      DispatchQueue.main.async {
        guard let self else { return }
        completion(folder ?? self.fallbackFolder, ask)
      }
    }
  }

  func adopt(_ download: WKDownload, profile: String, webView: WKWebView?) {
    let item = Item(url: download.originalRequest?.url?.absoluteString ?? "", profile: profile)
    item.webView = webView
    item.request = download.originalRequest
    attach(download, to: item)
    items[item.id] = item
  }

  private func attach(_ download: WKDownload, to item: Item) {
    item.download = download
    byDownload[ObjectIdentifier(download)] = item.id
    download.delegate = self
    item.progress = download.progress.observe(\.completedUnitCount, options: [.new]) { [weak self, weak item] progress, _ in
      DispatchQueue.main.async {
        guard let self, let item, item.phase == .running else { return }
        item.received = progress.completedUnitCount
        item.total = max(0, progress.totalUnitCount)
        let now = Date()
        let elapsed = now.timeIntervalSince(item.sampledAt)
        if elapsed >= 0.5 {
          item.speed = Double(item.received - item.sampledBytes) / elapsed
          item.sampledAt = now
          item.sampledBytes = item.received
        }
        if now.timeIntervalSince(item.reportedAt) >= 0.25 {
          item.reportedAt = now
          self.report(item)
        }
      }
    }
  }

  private func detach(_ item: Item) {
    if let download = item.download { byDownload.removeValue(forKey: ObjectIdentifier(download)) }
    item.progress = nil
    item.download = nil
  }

  private func item(for download: WKDownload) -> Item? { byDownload[ObjectIdentifier(download)].flatMap { items[$0] } }

  private func report(_ item: Item) {
    ArdiaEvents.emit("downloads.changed", data: [
      "id": item.id, "url": item.url, "filename": item.filename, "path": item.path, "state": item.phase.state,
      "paused": item.phase.isPaused,
      "received": Double(item.received), "total": Double(item.total), "speed": item.speed, "mimeType": item.mimeType,
      "profile": item.profile, "offTheRecord": false, "staging": item.staging?.path ?? NSNull(),
    ])
  }

  static let stagingPrefix = ".ardia-download-"

  static func makeStaging(in folder: URL, uuid: String) -> URL? {
    let staging = folder.appendingPathComponent(stagingPrefix + uuid, isDirectory: true)
    return mkdir(staging.path, 0o700) == 0 ? staging : nil
  }

  static func plainAbsolute(_ path: String) -> Bool {
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    return parts.count > 1 && parts[0].isEmpty && parts.dropFirst().allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
  }

  static func removeStaging(_ path: String) -> Bool {
    let folder = (path as NSString).deletingLastPathComponent
    let name = (path as NSString).lastPathComponent
    guard plainAbsolute(path), plainAbsolute(folder), name.hasPrefix(stagingPrefix),
      UUID(uuidString: String(name.dropFirst(stagingPrefix.count))) != nil
    else { return false }
    var info = stat()
    guard lstat(folder, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { return false }
    guard lstat(path, &info) == 0 else { return errno == ENOENT }
    guard info.st_mode & S_IFMT == S_IFDIR else { return false }
    return (try? FileManager.default.removeItem(atPath: path)) != nil
  }

  private static func identity(_ path: String) -> FileIdentity? {
    var info = stat()
    guard lstat(path, &info) == 0 else { return nil }
    return FileIdentity(device: info.st_dev, inode: info.st_ino)
  }

  private static func dropStaging(_ item: Item) {
    guard let staging = item.staging else { return }
    item.staging = nil
    try? FileManager.default.removeItem(at: staging)
  }

  private static func place(_ file: URL, at final: URL, replacing: FileIdentity?) -> URL? {
    if let replacing, identity(final.path) == replacing, rename(file.path, final.path) == 0 { return final }
    let base = final.deletingPathExtension().lastPathComponent
    let ext = final.pathExtension
    for n in 0...9999 {
      let name = n == 0 ? final.lastPathComponent : ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
      let candidate = final.deletingLastPathComponent().appendingPathComponent(name)
      if renamex_np(file.path, candidate.path, UInt32(RENAME_EXCL)) == 0 { return candidate }
      if errno != EEXIST { return nil }
    }
    return nil
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                completionHandler: @escaping (URL?) -> Void) {
    guard let item = item(for: download) else { return completionHandler(nil) }
    if let file = item.stagingFile {
      try? FileManager.default.removeItem(at: file)
      item.path = file.path
      report(item)
      return completionHandler(file)
    }
    let name = Self.safeName(suggestedFilename.isEmpty ? (response.suggestedFilename ?? "download") : suggestedFilename)
    item.mimeType = response.mimeType ?? ""
    item.total = max(0, response.expectedContentLength)
    let accept = { (target: URL?, replacing: Bool) in
      guard let target, let staging = Self.makeStaging(in: target.deletingLastPathComponent(), uuid: item.uuid) else {
        item.phase = target == nil ? .cancelled : .failed
        self.report(item)
        completionHandler(nil)
        return
      }
      item.final = target
      item.replaces = replacing ? Self.identity(target.path) : nil
      item.staging = staging
      item.filename = target.lastPathComponent
      let file = staging.appendingPathComponent(item.filename)
      item.path = file.path
      self.report(item)
      completionHandler(file)
    }
    resolveDestination(for: item.profile) { folder, ask in
      guard ask, !LaunchConfig.shared.background else { return accept(folder.appendingPathComponent(name), false) }
      let panel = NSSavePanel()
      panel.directoryURL = folder
      panel.nameFieldStringValue = name
      panel.begin { response in accept(response == .OK ? panel.url : nil, true) }
    }
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let item = item(for: download) else { return }
    detach(item)
    if let file = item.stagingFile, let final = item.final, let placed = Self.place(file, at: final, replacing: item.replaces) {
      item.path = placed.path
      item.filename = placed.lastPathComponent
      item.phase = .finished
      let size = ((try? FileManager.default.attributesOfItem(atPath: placed.path))?[.size] as? NSNumber)?.int64Value
      if let size {
        item.received = size
        item.total = size
      }
    } else {
      item.phase = .failed
    }
    Self.dropStaging(item)
    report(item)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    guard let item = item(for: download) else { return }
    detach(item)
    switch item.phase {
    case .pausing, .paused:
      if let resumeData { item.resumeData = resumeData }
      item.phase = .paused
    case .finished, .failed, .cancelled:
      break
    case .running, .resuming:
      item.phase = (error as NSError).code == NSURLErrorCancelled ? .cancelled : .failed
      Self.dropStaging(item)
    }
    report(item)
  }

  func handles(_ id: String) -> Bool { id.hasPrefix(Self.idPrefix) }

  func cancelAll(profile: String) {
    for item in items.values where item.profile == profile && !item.phase.isDone { command("cancel", id: item.id) }
  }

  func command(_ action: String, id: String) {
    guard let item = items[id] else { return }
    switch action {
    case "cancel":
      guard !item.phase.isDone else { return }
      let download = item.download
      item.phase = .cancelled
      item.resumeData = nil
      detach(item)
      report(item)
      if let download {
        download.cancel { _ in DispatchQueue.main.async { Self.dropStaging(item) } }
      } else {
        Self.dropStaging(item)
      }
    case "pause":
      guard item.phase == .running, let download = item.download else { return }
      item.phase = .pausing
      report(item)
      download.cancel { [weak self] data in
        DispatchQueue.main.async {
          if let data { item.resumeData = data }
          if item.download === download { self?.detach(item) }
          if item.phase == .pausing { item.phase = .paused }
        }
      }
    case "resume":
      guard item.phase == .paused else { return }
      let data = item.resumeData
      let saved = item.request ?? URL(string: item.url).map { URLRequest(url: $0) }
      let request = saved.flatMap { ["GET", "HEAD"].contains(($0.httpMethod ?? "GET").uppercased()) ? $0 : nil }
      guard data != nil || request != nil else {
        item.phase = .failed
        Self.dropStaging(item)
        return report(item)
      }
      item.phase = .resuming
      item.resumeData = nil
      let host = item.webView ?? WebKitHub.shared.resumeHost(for: item.profile)
      let resumed: (WKDownload) -> Void = { [weak self] download in
        DispatchQueue.main.async {
          guard let self else { return }
          guard item.phase == .resuming else { return download.cancel(nil) }
          item.phase = .running
          if data == nil { item.received = 0 }
          item.sampledAt = Date()
          item.sampledBytes = item.received
          self.attach(download, to: item)
          self.report(item)
        }
      }
      if let data { host.resumeDownload(fromResumeData: data, completionHandler: resumed) } else if let request { host.startDownload(using: request, completionHandler: resumed) }
    default: break
    }
  }

  static func safeName(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
    let trimmed = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
    return trimmed.isEmpty ? "download" : trimmed
  }
}
