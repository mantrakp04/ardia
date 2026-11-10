import CryptoKit
import Foundation

struct VaultGeneratedEntry: Codable, Sendable {
  var id: String
  var origin: String
  var username: String
  var password: String
  var createdAt: Double
  var submitted: Bool

  func jsonObject() -> [String: Any] {
    ["id": id, "origin": origin, "username": username, "createdAt": createdAt, "submitted": submitted]
  }
}

struct VaultGeneratedFile: Codable, Sendable {
  var version = 1
  var keepDays: Int
  var entries: [VaultGeneratedEntry]
}

enum VaultGenerated {
  static let provider = "generated"
  static let defaultKeepDays = 7
  static let keepForever = -1
  static let keepNone = 0
  static let longestKeep = 3650
  static let mostEntries = 200
  static let purgeInterval: TimeInterval = 3600

  private static let queue = DispatchQueue(label: "ardia.vaults.generated", qos: .utility)
  nonisolated(unsafe) private static var purgeTimer: DispatchSourceTimer?
  nonisolated(unsafe) private static var hookInstalled = false

  private static var fileURL: URL? {
    let base: URL
    if let sandbox = VaultSandbox.directory {
      base = URL(fileURLWithPath: sandbox, isDirectory: true)
    } else if let data = LaunchConfig.shared.dataDirectory {
      base = URL(fileURLWithPath: data, isDirectory: true)
    } else if let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
      base = support.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Ardia", isDirectory: true)
    } else {
      return nil
    }
    return base.appendingPathComponent("Password Managers", isDirectory: true).appendingPathComponent("Generated.vault")
  }

  static func nowMilliseconds() -> Double { Date().timeIntervalSince1970 * 1000 }

  static func clampedKeepDays(_ days: Int) -> Int {
    if days < 0 { return keepForever }
    return min(days, longestKeep)
  }

  static func isExpired(_ entry: VaultGeneratedEntry, keepDays: Int, now: Double) -> Bool {
    if keepDays == keepNone { return true }
    if keepDays < 0 { return false }
    return now - entry.createdAt >= Double(keepDays) * 86_400_000
  }

  static func sameSite(_ kept: String, _ origin: String) -> Bool {
    kept == origin || VaultOriginMatch.matches([kept], origin: origin)
  }

  static func installSubmitHook() {
    guard !hookInstalled else { return }
    hookInstalled = true
    ArdiaWebView.setGeneratedVaultSubmitHandler { password, username, origin in
      VaultGenerated.submitted(password: password, username: username, origin: origin)
    }
  }

  static func keep(password: String, origin: String, replacing previous: String?) {
    guard !password.isEmpty, !origin.isEmpty else { return }
    let created = nowMilliseconds()
    let fresh = VaultGeneratedEntry(id: UUID().uuidString, origin: origin, username: "", password: password, createdAt: created, submitted: false)
    change { file in
      guard file.keepDays != keepNone else { return false }
      if let previous {
        file.entries.removeAll { $0.origin == origin && $0.password == previous && !$0.submitted }
      }
      file.entries.removeAll { $0.origin == origin && $0.password == password }
      file.entries.append(fresh)
      if file.entries.count > mostEntries { file.entries.removeFirst(file.entries.count - mostEntries) }
      return true
    }
  }

  static func submitted(password: String, username: String, origin: String) {
    let name = String(username.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1024))
    change { file in
      var changed = false
      for index in file.entries.indices where sameSite(file.entries[index].origin, origin) && file.entries[index].password == password {
        file.entries[index].submitted = true
        if !name.isEmpty { file.entries[index].username = name }
        changed = true
      }
      return changed
    }
  }

  static func replacePassword(origin: String, from previous: String, to password: String) {
    guard !password.isEmpty, previous != password else { return }
    change { file in
      var changed = false
      for index in file.entries.indices where sameSite(file.entries[index].origin, origin) && file.entries[index].password == previous {
        file.entries[index].password = password
        changed = true
      }
      return changed
    }
  }

  static func saved(password: String, origin: String) {
    guard !password.isEmpty else { return }
    change { file in
      let before = file.entries.count
      file.entries.removeAll { sameSite($0.origin, origin) && $0.password == password }
      return file.entries.count != before
    }
  }

  static func delete(id: String) async -> Bool {
    await withCheckedContinuation { done in
      change(
        { file in
          let before = file.entries.count
          file.entries.removeAll { $0.id == id }
          return file.entries.count != before
        }, then: { done.resume(returning: $0) })
    }
  }

  static func setKeepDays(_ days: Int) {
    let keep = clampedKeepDays(days)
    change { file in
      let changed = file.keepDays != keep
      file.keepDays = keep
      return changed
    }
    startPurging()
  }

  static func list() async -> [[String: Any]] {
    await withCheckedContinuation { done in
      queue.async {
        let file = purgedFile()
        done.resume(returning: file.entries.sorted { $0.createdAt > $1.createdAt }.map { $0.jsonObject() })
      }
    }
  }

  static func entry(_ id: String) async -> VaultGeneratedEntry? {
    await withCheckedContinuation { done in
      queue.async { done.resume(returning: purgedFile().entries.first { $0.id == id }) }
    }
  }

  private static func startPurging() {
    queue.async {
      guard purgeTimer == nil else { return }
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now() + purgeInterval, repeating: purgeInterval, leeway: .seconds(60))
      timer.setEventHandler { _ = purgedFile() }
      purgeTimer = timer
      timer.resume()
    }
  }

  private static func change(_ edit: @escaping @Sendable (inout VaultGeneratedFile) -> Bool, then: (@Sendable (Bool) -> Void)? = nil) {
    queue.async {
      var file = purgedFile()
      let changed = edit(&file)
      if changed {
        if file.keepDays == keepNone { file.entries = [] }
        write(file)
        announce()
      }
      then?(changed)
    }
  }

  private static func purgedFile() -> VaultGeneratedFile {
    var file = read() ?? VaultGeneratedFile(keepDays: defaultKeepDays, entries: [])
    let now = nowMilliseconds()
    let before = file.entries.count
    file.entries.removeAll { isExpired($0, keepDays: file.keepDays, now: now) || $0.password.isEmpty }
    if file.entries.count != before {
      write(file)
      announce()
    }
    return file
  }

  private static func announce() {
    DispatchQueue.main.async { ArdiaEvents.emit("vaults.generatedChanged", data: [:]) }
  }

  private static func read() -> VaultGeneratedFile? {
    guard let url = fileURL, let sealed = try? Data(contentsOf: url), let box = try? AES.GCM.SealedBox(combined: sealed) else { return nil }
    for key in VaultStoreKey.candidates() {
      guard let plain = try? AES.GCM.open(box, using: key) else { continue }
      guard let file = try? JSONDecoder().decode(VaultGeneratedFile.self, from: plain), file.version == 1 else { return nil }
      return file
    }
    return nil
  }

  private static func write(_ file: VaultGeneratedFile) {
    guard let url = fileURL else { return }
    if file.entries.isEmpty && file.keepDays == defaultKeepDays {
      try? FileManager.default.removeItem(at: url)
      return
    }
    guard let key = VaultStoreKey.current(creating: true), let plain = try? JSONEncoder().encode(file),
      let sealed = try? AES.GCM.seal(plain, using: key).combined
    else { return }
    let directory = url.deletingLastPathComponent()
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try sealed.write(to: url, options: [.atomic])
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var marked = url
      try? marked.setResourceValues(values)
    } catch {
      NSLog("[vaults] couldn't write the generated passwords: %@", error.localizedDescription)
    }
  }
}
