import Foundation
import Observation
import OSLog
import SwiftData
import WebKit

public enum DownloadOutcome: Equatable, Sendable {
  case finished(URL)
  case failed(fileName: String)
}

public enum DownloadError: Error, Equatable {
  case cannotRetry
  case couldNotDelete(fileName: String)
}

@MainActor
@Observable
public final class DownloadManager {
  public static let defaultDirectory = URL.documentsDirectory.appending(path: "Downloads", directoryHint: .isDirectory)
  public static let defaultPrivateDirectory = URL.temporaryDirectory.appending(path: "ArdiaPrivateDownloads", directoryHint: .isDirectory)
  static let progressInterval: Duration = .milliseconds(250)
  static let log = Logger(subsystem: "com.ardia.browser.ios", category: "downloads")

  public let directory: URL
  public let privateDirectory: URL
  public private(set) var items: [DownloadItem] = []
  @ObservationIgnored public var onOutcome: (@MainActor (DownloadOutcome) -> Void)?
  @ObservationIgnored public var startDownload: (@MainActor (URL) -> Void)?

  @ObservationIgnored private let store: (any DownloadStore)?
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private var running: [ObjectIdentifier: Running] = [:]
  @ObservationIgnored private var delegate: DownloadDelegate?
  @ObservationIgnored private var progressTask: Task<Void, Never>?

  private struct Running {
    let id: UUID
    let download: WKDownload
    var destination: URL?
  }

  public init(directory: URL = DownloadManager.defaultDirectory, privateDirectory: URL = DownloadManager.defaultPrivateDirectory, store: (any DownloadStore)? = nil, now: @escaping () -> Date = Date.init) {
    self.directory = directory
    self.privateDirectory = privateDirectory
    self.store = store
    self.now = now
    removeContents(of: privateDirectory)
    items = loadSaved()
  }

  public static func forStore(_ context: ModelContext) -> DownloadManager {
    let inMemory = context.container.configurations.contains { $0.isStoredInMemoryOnly }
    let directory = inMemory ? URL.temporaryDirectory.appending(path: "ArdiaDemoDownloads", directoryHint: .isDirectory) : defaultDirectory
    return DownloadManager(directory: directory, privateDirectory: defaultPrivateDirectory, store: SwiftDataDownloadStore(context: ModelContext(context.container)))
  }

  public func fileURL(for item: DownloadItem) -> URL? {
    guard item.state == .finished, !item.fileName.isEmpty else { return nil }
    return folder(for: item).appending(path: item.fileName)
  }

  private func folder(for item: DownloadItem) -> URL {
    item.isPrivate ? privateDirectory : directory
  }

  private func ownedFile(of item: DownloadItem) -> URL? {
    guard item.ownsFile, !item.fileName.isEmpty else { return nil }
    return folder(for: item).appending(path: item.fileName)
  }

  public func fileExists(_ item: DownloadItem) -> Bool {
    fileURL(for: item).map { FileManager.default.fileExists(atPath: $0.path(percentEncoded: false)) } ?? false
  }

  public func cancel(_ id: UUID) {
    guard let before = item(id), before.isRunning else { return }
    let partial = ownedFile(of: before)
    if let key = running.first(where: { $0.value.id == id })?.key, let entry = running.removeValue(forKey: key) {
      let destination = entry.destination ?? partial
      entry.download.cancel { _ in
        Task { @MainActor [weak self] in self?.removePartialFile(destination) }
      }
    } else {
      removePartialFile(partial)
    }
    update(id, saving: true) { $0.cancelling(at: now()) }
  }

  public func retry(_ id: UUID) throws {
    guard let item = item(id), item.canRetry, let source = item.sourceURL, let startDownload else { throw DownloadError.cannotRetry }
    remove([id])
    startDownload(source)
  }

  public func delete(_ id: UUID) throws {
    guard let item = item(id) else { return }
    if item.isRunning { cancel(id) }
    if let file = fileURL(for: item) ?? ownedFile(of: item), FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) {
      do {
        try FileManager.default.removeItem(at: file)
      } catch {
        Self.log.error("Couldn't delete a download: \(error.localizedDescription, privacy: .public)")
        throw DownloadError.couldNotDelete(fileName: item.fileName)
      }
    }
    remove([id])
  }

  public func clearInactive() {
    remove(Set(items.filter { !$0.isRunning }.map(\.id)))
  }

  public func endPrivateBrowsing() {
    let ended = items.filter(\.isPrivate)
    for item in ended where item.isRunning { cancel(item.id) }
    remove(Set(ended.map(\.id)))
    removeContents(of: privateDirectory)
  }

  public func add(_ added: [DownloadItem]) {
    let known = Set(items.map(\.id))
    let fresh = added.filter { !known.contains($0.id) }
    items = (fresh + items).sorted(by: Self.newestFirst)
    fresh.forEach(persist)
  }

  func track(_ download: WKDownload) {
    if delegate == nil { delegate = DownloadDelegate(manager: self) }
    download.delegate = delegate
    let id = UUID()
    let isPrivate = !(download.webView?.configuration.websiteDataStore.isPersistent ?? true)
    running[ObjectIdentifier(download)] = Running(id: id, download: download)
    begin(id: id, source: download.originalRequest?.url, isPrivate: isPrivate)
    watchProgress()
  }

  func destination(for download: WKDownload, suggestedFilename: String) -> URL? {
    let key = ObjectIdentifier(download)
    guard let entry = running[key], let current = item(entry.id) else { return nil }
    let folder = folder(for: current)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      running[key] = nil
      fail(entry.id, error: error)
      return nil
    }
    let neighbours = items.filter { $0.id != entry.id && $0.isPrivate == current.isPrivate }.map(\.fileName)
    let reserved = Set(neighbours).union(running.values.compactMap { $0.destination?.lastPathComponent })
    let url = Self.uniqueURL(in: folder, for: suggestedFilename, excluding: reserved)
    running[key]?.destination = url
    place(entry.id, as: url.lastPathComponent)
    return url
  }

  func finished(_ download: WKDownload) {
    guard let entry = running.removeValue(forKey: ObjectIdentifier(download)) else { return }
    if let destination = entry.destination {
      finish(entry.id, file: destination)
    } else {
      fail(entry.id, error: CocoaError(.fileWriteUnknown))
    }
  }

  func failed(_ download: WKDownload, error: any Error) {
    guard let entry = running.removeValue(forKey: ObjectIdentifier(download)) else { return }
    fail(entry.id, error: error)
  }

  func begin(id: UUID, source: URL?, isPrivate: Bool) {
    let item = DownloadItem.started(id: id, source: source, isPrivate: isPrivate, at: now())
    items = ([item] + items).sorted(by: Self.newestFirst)
    persist(item)
  }

  func place(_ id: UUID, as name: String) {
    update(id, saving: true) { $0.placed(as: name) }
  }

  func progress(_ id: UUID, received: Int64, expected: Int64?) {
    update(id, saving: false) { $0.receiving(received, of: expected) }
  }

  func finish(_ id: UUID, file: URL) {
    guard item(id)?.isRunning == true else { return }
    let attributes = try? FileManager.default.attributesOfItem(atPath: file.path(percentEncoded: false))
    let size = (attributes?[.size] as? NSNumber)?.int64Value
    update(id, saving: true) { $0.finishing(at: now(), size: size) }
    onOutcome?(.finished(file))
  }

  func fail(_ id: UUID, error: any Error) {
    guard let before = item(id), before.isRunning else { return }
    removePartialFile(ownedFile(of: before))
    update(id, saving: true) { $0.failing(DownloadFailure(error), at: now()) }
    onOutcome?(.failed(fileName: before.fileName))
  }

  private func item(_ id: UUID) -> DownloadItem? {
    items.first { $0.id == id }
  }

  private func update(_ id: UUID, saving: Bool, _ change: (DownloadItem) -> DownloadItem) {
    guard let before = item(id) else { return }
    let after = change(before)
    guard after != before else { return }
    items = items.map { $0.id == id ? after : $0 }
    if saving { persist(after) }
  }

  private func remove(_ ids: Set<UUID>) {
    guard !ids.isEmpty else { return }
    let saved = Set(items.filter { ids.contains($0.id) && !$0.isPrivate }.map(\.id))
    items = items.filter { !ids.contains($0.id) }
    do {
      try store?.deleteDownloads(saved)
    } catch {
      Self.log.error("Couldn't forget downloads: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func persist(_ item: DownloadItem) {
    guard let store, !item.isPrivate else { return }
    do {
      try store.saveDownload(item)
    } catch {
      Self.log.error("Couldn't save a download: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func loadSaved() -> [DownloadItem] {
    guard let store else { return [] }
    do {
      let saved = try store.loadDownloads()
      let settled = saved.map { $0.relaunched() }
      for (before, after) in zip(saved, settled) where before != after {
        removePartialFile(ownedFile(of: before))
        persist(after)
      }
      return settled.sorted(by: Self.newestFirst)
    } catch {
      Self.log.error("Couldn't load downloads: \(error.localizedDescription, privacy: .public)")
      return []
    }
  }

  private func removeContents(of folder: URL) {
    guard FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)) else { return }
    let files: [URL]
    do {
      files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
    } catch {
      Self.log.error("Couldn't list private downloads: \(error.localizedDescription, privacy: .public)")
      return
    }
    for file in files { removePartialFile(file) }
  }

  private func removePartialFile(_ url: URL?) {
    guard let url, FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return }
    do {
      try FileManager.default.removeItem(at: url)
    } catch {
      Self.log.error("Couldn't remove a partial download: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func watchProgress() {
    guard progressTask == nil else { return }
    progressTask = Task { [weak self] in
      while let self, !self.running.isEmpty, !Task.isCancelled {
        for entry in self.running.values {
          let progress = entry.download.progress
          self.progress(entry.id, received: progress.completedUnitCount, expected: progress.totalUnitCount)
        }
        try? await Task.sleep(for: Self.progressInterval)
      }
      self?.progressTask = nil
    }
  }

  private static func newestFirst(_ lhs: DownloadItem, _ rhs: DownloadItem) -> Bool {
    lhs.startedAt > rhs.startedAt
  }

  nonisolated static func uniqueURL(in directory: URL, for suggested: String, excluding reserved: Set<String> = []) -> URL {
    let cleaned = suggested
      .replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".-")))
    let name = cleaned.isEmpty ? String(localized: "Download") : cleaned
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    func taken(_ url: URL) -> Bool {
      reserved.contains(url.lastPathComponent) || FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }
    var candidate = directory.appending(path: name)
    var counter = 2
    while taken(candidate) {
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
    manager?.failed(download, error: error)
  }
}
