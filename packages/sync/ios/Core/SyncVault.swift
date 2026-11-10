import Foundation

public final class SyncVault {
  public static let fileExtension = "nns"

  public let folder: URL
  let keys: SyncKeys
  let fileManager = FileManager.default
  public var coordination: SyncCoordination?

  public init(folder: URL, keys: SyncKeys) {
    self.folder = folder
    self.keys = keys
  }

  public var chainURL: URL { folder.appendingPathComponent(keys.chainTag, isDirectory: true) }
  func scopeURL(_ scope: String) -> URL { chainURL.appendingPathComponent(keys.scopeTag(scope), isDirectory: true) }

  public func chainExists() -> Bool {
    var isDirectory: ObjCBool = false
    return fileManager.fileExists(atPath: chainURL.path, isDirectory: &isDirectory) && isDirectory.boolValue
  }

  public func createChain() throws {
    try fileManager.createDirectory(at: chainURL, withIntermediateDirectories: true)
  }

  @discardableResult
  public func write(scope: String, payload: Data) throws -> String {
    let id = SyncKeys.newFileId()
    let scopeTag = keys.scopeTag(scope)
    let sealed = try keys.seal(payload, scopeTag: scopeTag, fileId: id)
    let directory = scopeURL(scope)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = directory.appendingPathComponent("\(id).\(Self.fileExtension)")
    let staging = try fileManager.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: directory, create: true)
    defer { try? fileManager.removeItem(at: staging) }
    let temporary = staging.appendingPathComponent(id)
    try sealed.write(to: temporary)
    try coordinate(writing: destination, options: .forReplacing) { url in
      try self.fileManager.moveItem(at: temporary, to: url)
    }
    return id
  }

  public struct RemoveFailed: Error {
    public let ids: [String]
    public let first: Error
  }

  public func remove(scope: String, ids: [String]) throws {
    let directory = scopeURL(scope)
    var failed: [String] = []
    var firstError: Error?
    for id in ids {
      let url = directory.appendingPathComponent("\(id).\(Self.fileExtension)")
      do {
        try coordinate(writing: url, options: .forDeleting) { url in try self.fileManager.removeItem(at: url) }
      } catch where !Self.isMissing(error) {
        failed.append(id)
        firstError = firstError ?? error
      } catch {}
      try? fileManager.removeItem(at: directory.appendingPathComponent(".\(id).\(Self.fileExtension).icloud"))
    }
    if let firstError { throw RemoveFailed(ids: failed, first: firstError) }
  }

  static func isMissing(_ error: Error) -> Bool {
    let error = error as NSError
    if error.domain == NSCocoaErrorDomain, [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(error.code) { return true }
    if error.domain == NSPOSIXErrorDomain, error.code == Int(ENOENT) { return true }
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? Error { return isMissing(underlying) }
    return false
  }

  public func deleteChain() throws {
    guard chainExists() else { return }
    try coordinate(writing: chainURL, options: .forDeleting) { url in try self.fileManager.removeItem(at: url) }
  }

  public struct File {
    public let id: String
    public let payload: Data
  }

  public struct Listing {
    public var files: [File] = []
    public var pending: [String] = []
    public var damaged: [(id: String, age: TimeInterval)] = []
    public var present: [String] = []
    public var timedOut = false
  }

  public func read(scope: String, skipping known: Set<String>) throws -> Listing {
    var listing = Listing()
    let directory = scopeURL(scope)
    let keysToRead: [URLResourceKey] = [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .contentModificationDateKey]
    let names: [String]
    do {
      names = try fileManager.contentsOfDirectory(atPath: directory.path)
    } catch where Self.isMissing(error) {
      return listing
    }
    let suffix = ".\(Self.fileExtension)"
    let scopeTag = keys.scopeTag(scope)
    var present = Set<String>()
    for name in names.sorted() {
      if name.hasPrefix("."), name.hasSuffix("\(suffix).icloud") {
        let id = String(name.dropFirst().dropLast(suffix.count + ".icloud".count))
        guard Base32.isTag(id), !present.contains(id) else { continue }
        present.insert(id)
        listing.present.append(id)
        if !known.contains(id) {
          listing.pending.append(id)
          try? fileManager.startDownloadingUbiquitousItem(at: directory.appendingPathComponent("\(id)\(suffix)"))
        }
        continue
      }
      guard name.hasSuffix(suffix) else { continue }
      let id = String(name.dropLast(suffix.count))
      guard Base32.isTag(id) else { continue }
      if present.insert(id).inserted { listing.present.append(id) }
      if known.contains(id) { continue }
      let url = directory.appendingPathComponent(name)
      let values = try? url.resourceValues(forKeys: Set(keysToRead))
      if values?.isUbiquitousItem == true, let status = values?.ubiquitousItemDownloadingStatus, status != .current {
        listing.pending.append(id)
        try? fileManager.startDownloadingUbiquitousItem(at: url)
        continue
      }
      do {
        let data = try coordinate(reading: url) { try Data(contentsOf: $0) }
        listing.files.append(File(id: id, payload: try keys.open(data, scopeTag: scopeTag, fileId: id)))
      } catch is SyncCoordination.TimedOut {
        listing.timedOut = true
        return listing
      } catch {
        let modified = values?.contentModificationDate ?? Date()
        listing.damaged.append((id, max(0, Date().timeIntervalSince(modified))))
      }
    }
    return listing
  }

  private func coordinate(writing url: URL, options: NSFileCoordinator.WritingOptions, _ body: (URL) throws -> Void) throws {
    try SyncCoordination.write(coordination, url, options: options, body)
  }

  private func coordinate<T>(reading url: URL, _ body: (URL) throws -> T) throws -> T {
    try SyncCoordination.read(coordination, url, options: [.withoutChanges], body)
  }
}

public final class SyncCoordination: @unchecked Sendable {
  public struct TimedOut: Error {
    public init() {}
  }

  public let timeout: TimeInterval
  private let lock = NSLock()
  private var active: [ObjectIdentifier: NSFileCoordinator] = [:]
  private var cancelled = false

  public init(timeout: TimeInterval) {
    self.timeout = timeout
  }

  public func cancelAll() {
    let running = lock.withLock {
      cancelled = true
      return Array(active.values)
    }
    for coordinator in running { coordinator.cancel() }
  }

  public func resume() {
    lock.withLock { cancelled = false }
  }

  public func read<T>(_ url: URL, options: NSFileCoordinator.ReadingOptions = [], _ body: (URL) throws -> T) throws -> T {
    try Self.read(self, url, options: options, body)
  }

  static func read<T>(_ coordination: SyncCoordination?, _ url: URL, options: NSFileCoordinator.ReadingOptions, _ body: (URL) throws -> T) throws -> T {
    var coordinationError: NSError?
    var result: Result<T, Error> = .failure(CocoaError(.fileReadUnknown))
    try run(coordination) { coordinator, begin in
      coordinator.coordinate(readingItemAt: url, options: options, error: &coordinationError) { url in
        guard begin() else { return }
        result = Result { try body(url) }
      }
    }
    if let coordinationError { throw coordinationError }
    return try result.get()
  }

  static func write(_ coordination: SyncCoordination?, _ url: URL, options: NSFileCoordinator.WritingOptions, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    try run(coordination) { coordinator, begin in
      coordinator.coordinate(writingItemAt: url, options: options, error: &coordinationError) { url in
        guard begin() else { return }
        do { try body(url) } catch { bodyError = error }
      }
    }
    if let error = coordinationError ?? bodyError { throw error }
  }

  static func move(_ coordination: SyncCoordination?, _ from: URL, to: URL, _ body: (URL, URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    try run(coordination) { coordinator, begin in
      coordinator.coordinate(writingItemAt: from, options: .forMoving, writingItemAt: to, options: .forReplacing, error: &coordinationError) { source, destination in
        guard begin() else { return }
        do { try body(source, destination) } catch { bodyError = error }
      }
    }
    if let error = coordinationError ?? bodyError { throw error }
  }

  static func run(_ coordination: SyncCoordination?, _ body: (NSFileCoordinator, _ begin: @escaping () -> Bool) -> Void) throws {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    guard let coordination else { return body(coordinator) { true } }
    try coordination.run(coordinator, body)
  }

  private final class Attempt {
    var started = false
    var expired = false
  }

  private func run(_ coordinator: NSFileCoordinator, _ body: (NSFileCoordinator, _ begin: @escaping () -> Bool) -> Void) throws {
    let key = ObjectIdentifier(coordinator)
    let refused = lock.withLock { () -> Bool in
      if cancelled { return true }
      active[key] = coordinator
      return false
    }
    if refused { throw TimedOut() }
    let attempt = Attempt()
    let timer = DispatchWorkItem { [lock] in
      let expire = lock.withLock { () -> Bool in
        guard !attempt.started else { return false }
        attempt.expired = true
        return true
      }
      if expire { coordinator.cancel() }
    }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: timer)
    body(coordinator) { [lock] in
      lock.withLock { () -> Bool in
        guard !attempt.expired, !self.cancelled else { return false }
        attempt.started = true
        return true
      }
    }
    timer.cancel()
    let gaveUp = lock.withLock { () -> Bool in
      active[key] = nil
      return !attempt.started && (attempt.expired || cancelled)
    }
    if gaveUp { throw TimedOut() }
  }
}

#if os(macOS)
public enum SyncFolder {
  public static var iCloudDrive: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
  }

  public static var iCloudDriveAvailable: Bool {
    var isDirectory: ObjCBool = false
    return FileManager.default.fileExists(atPath: iCloudDrive.path, isDirectory: &isDirectory) && isDirectory.boolValue
  }

  public static func isInICloudDrive(_ url: URL) -> Bool {
    url.standardizedFileURL.path.hasPrefix(iCloudDrive.standardizedFileURL.path)
  }

  public static func hasSyncData(_ folder: URL) -> Bool {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    return names.contains { Base32.isTag($0) }
  }
}
#endif
