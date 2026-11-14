import ArdiaSync
import Darwin
import Foundation

public final class PhoneInbox: @unchecked Sendable {
  public struct Removal: Equatable, Sendable {
    public var profileSyncId: String?
    public var urls: Set<String>
    public var includesUnassigned: Bool

    public init(profileSyncId: String?, urls: Set<String>, includesUnassigned: Bool = false) {
      self.profileSyncId = profileSyncId
      self.urls = urls
      self.includesUnassigned = includesUnassigned
    }
  }

  public struct Entry: Equatable, Sendable {
    public let id: Int64
    public var received: [ReceivedTab]
    public var removals: [Removal]
  }

  public struct WriteFailed: Error {}

  public static let receivedLimit = 200
  public static let appliedMemory = 1_000
  static let format = 2
  public static let unreadableMessage = "Ardia couldn’t read the tabs and history changes waiting from your Mac, and set them aside."
  public static let partlyUnreadableMessage = "Ardia set aside some tabs and history changes from your Mac it couldn’t read."

  private struct Contents {
    var entries: [Entry] = []
    var applied: [String] = []
    var readUpTo: Int64 = 0
  }

  public let file: URL
  private let clock: () -> Date
  private let lock = NSLock()
  private var contents: Contents?
  private var failNextWrite = false
  private var reported: String?
  private var changeHandler: ((Int) -> Void)?
  private var problemHandler: ((String) -> Void)?

  public init(file: URL, clock: @escaping () -> Date = Date.init) {
    self.file = file
    self.clock = clock
  }

  public var problem: String? {
    lock.withLock {
      _ = loaded()
      return reported
    }
  }

  public var onChange: ((Int) -> Void)? {
    get { lock.withLock { changeHandler } }
    set { lock.withLock { changeHandler = newValue } }
  }

  public var onProblem: ((String) -> Void)? {
    get { lock.withLock { problemHandler } }
    set { lock.withLock { problemHandler = newValue } }
  }

  public func receive(_ tabs: [ReceivedTab]) -> Bool {
    change { current in
      let pending = Set(current.entries.flatMap { $0.received.map(\.key) })
      var seen = Set<String>()
      let fresh = tabs.filter { seen.insert($0.key).inserted && !pending.contains($0.key) && !current.applied.contains($0.key) }
      guard !fresh.isEmpty else { return false }
      Self.add(&current, received: fresh, removals: [])
      Self.trimReceived(&current)
      return true
    }
  }

  public func remove(_ removal: Removal) -> Bool {
    change { current in
      let pending = Set(current.entries.flatMap(\.removals).filter { $0.profileSyncId == removal.profileSyncId }.flatMap(\.urls))
      let fresh = removal.urls.subtracting(pending)
      guard !fresh.isEmpty else { return false }
      Self.add(&current, received: [], removals: [Removal(profileSyncId: removal.profileSyncId, urls: fresh, includesUnassigned: removal.includesUnassigned)])
      return true
    }
  }

  public func entries() -> [Entry] {
    lock.withLock {
      let current = loaded()
      guard let newest = current.entries.map(\.id).max() else { return [] }
      if newest > current.readUpTo {
        var next = current
        next.readUpTo = newest
        if (try? persist(next)) != nil { contents = next }
      }
      return current.entries
    }
  }

  public func applied(_ ids: Set<Int64>) throws {
    let outcome: (Int, ((Int) -> Void)?)? = try lock.withLock {
      let current = loaded()
      let done = current.entries.filter { ids.contains($0.id) }
      guard !done.isEmpty else { return nil }
      var next = current
      next.entries.removeAll { ids.contains($0.id) }
      for key in done.flatMap({ $0.received.map(\.key) }) { Self.remember(&next.applied, key) }
      try persist(next)
      contents = next
      return (next.entries.count, changeHandler)
    }
    if let (count, handler) = outcome { handler?(count) }
  }

  public func removedUrls(profileSyncId: String?) -> Set<String> {
    lock.withLock {
      Set(loaded().entries.flatMap(\.removals).filter { $0.profileSyncId == profileSyncId }.flatMap(\.urls))
    }
  }

  public func load() {
    lock.withLock { _ = loaded() }
  }

  private func change(_ edit: (inout Contents) -> Bool) -> Bool {
    let outcome: (Bool, Int?, ((Int) -> Void)?) = lock.withLock {
      let current = loaded()
      if failNextWrite {
        failNextWrite = false
        return (false, nil, nil)
      }
      var next = current
      guard edit(&next) else { return (true, nil, nil) }
      do {
        try persist(next)
      } catch {
        return (false, nil, nil)
      }
      contents = next
      return (true, next.entries.count, changeHandler)
    }
    if let count = outcome.1 { outcome.2?(count) }
    return outcome.0
  }

  private static func add(_ current: inout Contents, received: [ReceivedTab], removals: [Removal]) {
    if let last = current.entries.last, last.id > current.readUpTo {
      var merged = last.removals
      for removal in removals {
        if let index = merged.firstIndex(where: { $0.profileSyncId == removal.profileSyncId }) {
          merged[index].urls.formUnion(removal.urls)
        } else {
          merged.append(removal)
        }
      }
      current.entries[current.entries.count - 1] = Entry(id: last.id, received: last.received + received, removals: merged)
    } else {
      let id = (current.entries.map(\.id).max() ?? current.readUpTo) + 1
      current.entries.append(Entry(id: id, received: received, removals: removals))
    }
  }

  private static func trimReceived(_ current: inout Contents) {
    let all = current.entries.flatMap(\.received)
    guard all.count > receivedLimit else { return }
    let dropped = Set(all.sorted { $0.sentAt < $1.sentAt }.prefix(all.count - receivedLimit).map(\.key))
    for index in current.entries.indices {
      current.entries[index].received.removeAll { dropped.contains($0.key) }
    }
    current.entries.removeAll { $0.received.isEmpty && $0.removals.isEmpty }
  }

  private static func remember(_ applied: inout [String], _ key: String) {
    guard !applied.contains(key) else { return }
    applied.append(key)
    if applied.count > appliedMemory { applied.removeFirst(applied.count - appliedMemory) }
  }

  private func loaded() -> Contents {
    if let contents { return contents }
    let fresh = read()
    contents = fresh
    return fresh
  }

  private func read() -> Contents {
    try? FileManager.default.removeItem(at: staging)
    guard let data = try? Data(contentsOf: file) else {
      if FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) {
        failNextWrite = true
        report(Self.unreadableMessage)
      }
      return Contents()
    }
    guard let parsed = Self.parse(data) else {
      setAside(data, wholeFile: true)
      failNextWrite = true
      report(Self.unreadableMessage)
      return Contents()
    }
    var entries: [Entry] = []
    var unreadable: [Any] = []
    for raw in parsed.entries {
      if let entry = (raw as? [String: Any]).flatMap(Self.entry) { entries.append(entry) } else { unreadable.append(raw) }
    }
    if !unreadable.isEmpty {
      if let data = try? JSONSerialization.data(withJSONObject: unreadable) { setAside(data, wholeFile: false) }
      report(Self.partlyUnreadableMessage)
    }
    return Contents(entries: entries, applied: parsed.applied, readUpTo: parsed.readUpTo)
  }

  private static func parse(_ data: Data) -> (entries: [Any], applied: [String], readUpTo: Int64)? {
    guard !data.isEmpty, let value = try? JSONSerialization.jsonObject(with: data) else { return nil }
    if let list = value as? [Any] { return (list, [], 0) }
    guard let object = value as? [String: Any], let list = object["entries"] as? [Any] else { return nil }
    let applied = (object["applied"] as? [Any])?.compactMap { $0 as? String }.filter { !$0.isEmpty } ?? []
    return (list, applied, (object["readUpTo"] as? NSNumber)?.int64Value ?? 0)
  }

  private func report(_ message: String) {
    reported = message
    let handler = problemHandler
    DispatchQueue.main.async { handler?(message) }
  }

  private func setAside(_ data: Data, wholeFile: Bool) {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
    let stamp = formatter.string(from: clock())
    let folder = file.deletingLastPathComponent()
    var aside = folder.appending(path: "\(file.lastPathComponent).unreadable-\(stamp)")
    var suffix = 1
    while FileManager.default.fileExists(atPath: aside.path(percentEncoded: false)) {
      aside = folder.appending(path: "\(file.lastPathComponent).unreadable-\(stamp)-\(suffix)")
      suffix += 1
    }
    if wholeFile, (try? FileManager.default.moveItem(at: file, to: aside)) != nil { return }
    try? data.write(to: aside, options: .atomic)
  }

  private var staging: URL { file.deletingLastPathComponent().appending(path: ".\(file.lastPathComponent).partial") }

  private func persist(_ next: Contents) throws {
    let folder = file.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let data = try JSONSerialization.data(withJSONObject: Self.json(next), options: [.sortedKeys])
    let staged = staging
    guard FileManager.default.createFile(atPath: staged.path(percentEncoded: false), contents: nil) else { throw WriteFailed() }
    let handle = try FileHandle(forWritingTo: staged)
    do {
      try handle.write(contentsOf: data)
      try handle.synchronize()
      try handle.close()
    } catch {
      try? handle.close()
      throw error
    }
    guard rename(staged.path(percentEncoded: false), file.path(percentEncoded: false)) == 0 else { throw WriteFailed() }
    let directory = open(folder.path(percentEncoded: false), O_RDONLY)
    if directory >= 0 {
      fsync(directory)
      close(directory)
    }
  }

  private static func json(_ contents: Contents) -> [String: Any] {
    ["v": format, "entries": contents.entries.map(json), "applied": contents.applied, "readUpTo": contents.readUpTo]
  }

  static func json(_ entry: Entry) -> [String: Any] {
    ["id": entry.id, "received": entry.received.map(json), "removals": entry.removals.map(json)]
  }

  public static func json(_ tab: ReceivedTab) -> [String: Any] {
    [
      "key": tab.key,
      "url": tab.url,
      "title": tab.title,
      "fromDevice": tab.fromDevice,
      "fromDeviceId": tab.fromDeviceId,
      "sentAt": milliseconds(tab.sentAt),
      "profileSyncId": tab.profileSyncId,
    ]
  }

  public static func json(_ removal: Removal) -> [String: Any] {
    ["profileSyncId": removal.profileSyncId ?? NSNull(), "urls": removal.urls.sorted(), "includesUnassigned": removal.includesUnassigned]
  }

  static func milliseconds(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

  private static func entry(_ value: [String: Any]) -> Entry? {
    guard let id = (value["id"] as? NSNumber)?.int64Value,
          let received = value["received"] as? [[String: Any]],
          let removals = value["removals"] as? [[String: Any]]
    else { return nil }
    var tabs: [ReceivedTab] = []
    for tab in received {
      guard let key = tab["key"] as? String, let url = tab["url"] as? String, let title = tab["title"] as? String,
            let fromDevice = tab["fromDevice"] as? String, let sentAt = (tab["sentAt"] as? NSNumber)?.doubleValue,
            let profile = tab["profileSyncId"] as? String, let fromDeviceId = tab["fromDeviceId"] as? String
      else { return nil }
      tabs.append(ReceivedTab(key: key, url: url, title: title, fromDevice: fromDevice, sentAt: Date(timeIntervalSince1970: sentAt / 1000), profileSyncId: profile, fromDeviceId: fromDeviceId))
    }
    var gone: [Removal] = []
    for removal in removals {
      guard let urls = removal["urls"] as? [String] else { return nil }
      let profile: String?
      switch removal["profileSyncId"] {
      case let text as String: profile = text
      case nil, is NSNull: profile = nil
      default: return nil
      }
      gone.append(Removal(profileSyncId: profile, urls: Set(urls), includesUnassigned: (removal["includesUnassigned"] as? Bool) ?? false))
    }
    return Entry(id: id, received: tabs, removals: gone)
  }
}
