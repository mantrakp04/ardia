import Foundation
import Security

typealias Ask = (_ title: String, _ message: String, _ buttons: [String]) -> Int?

struct LegacyMigrator {
  struct Context {
    var oldData: URL
    var newData: URL
    var extras: [(URL, URL)] = []
    var oldDefaults: PreferencesDomain
    var newDefaults: PreferencesDomain
    var oldSecrets: SecretStore?
    var newSecrets: SecretStore?
    var accessGroups: [(old: String, new: String)] = []
    var groupMover: AccessGroupMover? = nil
    var oldAppRunning: () -> Bool
    var oldAppWasDefaultBrowser: () -> Bool = { false }
    var ask: Ask
    var crashAfter: String? = nil
  }

  enum Outcome: Equatable {
    case proceed
    case quit
  }

  struct Journal: Codable, Equatable {
    var version = 1
    var phase: String
    var outcome: String?
    var files: Int?
    var secrets: [String: String]?
    var secretAttempts: Int?
    var groups: String?
    var groupAttempts: Int?
    var defaultBrowser: String?
    var finishedAt: Date?

    var isDone: Bool { phase == "done" && groups != "pending" && defaultBrowser != nil && !secretsPending }

    static let secretTries = 3
    static func retryable(_ outcome: String) -> Bool { outcome == "denied" || outcome.hasPrefix("failed") }
    var secretsPending: Bool {
      (secretAttempts ?? 1) < Self.secretTries && (secrets ?? [:]).values.contains(where: Self.retryable)
    }
  }

  static let journalName = ".legacy-migration.json"
  static let defaultBrowserOfferName = "default-browser-offer.json"
  static let stagingName = ".legacy-migration-staging"
  static let lockName = ".legacy-migration.lock"
  static let asideName = ".legacy-migration-replaced"

  let context: Context
  private let fm = FileManager.default

  init(_ context: Context) { self.context = context }

  var journalURL: URL { context.newData.appendingPathComponent(Self.journalName) }
  var oldRoot: URL { context.oldData.resolvingSymlinksInPath() }
  var stagingURL: URL { context.newData.appendingPathComponent(Self.stagingName) }

  func readJournal() -> Journal? {
    guard let data = try? Data(contentsOf: journalURL) else { return nil }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try? decoder.decode(Journal.self, from: data)
  }

  var isDone: Bool { readJournal()?.isDone == true }

  func run() -> Outcome {
    if isDone { return .proceed }
    do {
      try fm.createDirectory(at: context.newData, withIntermediateDirectories: true)
    } catch {
      log("can't make \(context.newData.path): \(error)")
      return .proceed
    }
    let lock = open(context.newData.appendingPathComponent(Self.lockName).path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
    guard lock >= 0 else {
      log("can't open the migration lock: \(String(cString: strerror(errno)))")
      return .quit
    }
    defer { close(lock) }
    let deadline = Date().addingTimeInterval(600)
    while flock(lock, LOCK_EX | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK || errno == EINTR, Date() < deadline else {
        log("another launch is migrating; quitting")
        return .quit
      }
      usleep(200_000)
    }
    defer { flock(lock, LOCK_UN) }
    return runLocked()
  }

  private func runLocked() -> Outcome {
    let journal = readJournal()
    if var done = journal, done.phase == "done" {
      let before = done
      if done.defaultBrowser == nil { done.defaultBrowser = checkDefaultBrowser() }
      if done.groups == "pending" {
        let (groups, counts) = moveAccessGroups()
        done.groups = groups
        if counts { done.groupAttempts = (done.groupAttempts ?? 0) + 1 }
        if done.groups == "pending", (done.groupAttempts ?? 0) >= 5 { done.groups = "failed" }
      }
      if done.secretsPending { retrySecrets(&done) }
      if done != before, !writeJournal(done) { log("couldn't record what's left to bring across") }
      return .proceed
    }
    if let publishing = journal, publishing.phase == "publishing" {
      return publishOrQuit() ? finish(publishing) : .quit
    }
    guard exists(context.oldData) else {
      return finish(Journal(phase: "done", outcome: "nothing"))
    }
    if hasData(context.newData) {
      log("\(context.newData.path) already has data; leaving it and \(context.oldData.path) as they are")
      return finish(Journal(phase: "done", outcome: "existing"))
    }
    var files = 0
    var secrets: [String: String] = [:]
    while true {
      while context.oldAppRunning() {
        let choice = context.ask(
          "Quit \(LegacyName.appName) to continue",
          "Ardia is the new name of \(LegacyName.appName). Quit \(LegacyName.appName), then click Continue to bring your tabs, passwords and settings across.",
          ["Continue", "Quit"])
        if choice != 0 { return .quit }
      }
      do {
        files = try stage()
      } catch {
        log("couldn't copy \(context.oldData.path): \(error)")
        try? fm.removeItem(at: stagingURL)
        let choice = context.ask(
          "Ardia couldn't bring your data across",
          "Copying your data from \(LegacyName.appName) failed (\(error.localizedDescription)). Nothing was changed. You can try again, quit, or start Ardia without it; \(LegacyName.appName)'s data stays where it is.",
          ["Try Again", "Quit", "Start Without It"])
        if choice == 0 { continue }
        if choice == 2 { return finish(Journal(phase: "done", outcome: "fresh")) }
        return .quit
      }
      if context.oldAppRunning() {
        try? fm.removeItem(at: stagingURL)
        continue
      }
      if crash("staged") { return .quit }

      if let old = context.oldSecrets, let new = context.newSecrets {
        for item in Renamed.keychain {
          switch copySecrets(item, from: old, to: new, skip: Self.accounts(of: item, in: secrets) { $0 == "copied" }) {
          case let .copied(results): secrets.merge(results) { $1 }
          case .quit:
            try? fm.removeItem(at: stagingURL)
            return .quit
          case .startFresh:
            try? fm.removeItem(at: stagingURL)
            return finish(Journal(phase: "done", outcome: "fresh"))
          }
        }
      }
      if crash("secrets") { return .quit }
      guard context.oldAppRunning() else { break }
      try? fm.removeItem(at: stagingURL)
    }

    let publishing = Journal(phase: "publishing", outcome: "migrated", files: files, secrets: secrets)
    guard writeJournal(publishing) else {
      log("couldn't write the journal")
      try? fm.removeItem(at: stagingURL)
      return .quit
    }
    if crash("journal") { return .quit }
    guard publishOrQuit() else { return .quit }
    if crash("published") { return .quit }
    return finish(publishing)
  }

  private func publishOrQuit() -> Bool {
    while true {
      do {
        return try publish()
      } catch {
        log("couldn't move the data in: \(error)")
        let choice = context.ask(
          "Ardia couldn't finish bringing your data across",
          "Moving your copied data into place failed (\(error.localizedDescription)). \(LegacyName.appName)'s data is untouched. Try again, or quit and Ardia will finish the next time it opens.",
          ["Try Again", "Quit"])
        if choice != 0 { return false }
      }
    }
  }

  func stage() throws -> Int {
    if exists(stagingURL) { try fm.removeItem(at: stagingURL) }
    try fm.copyItem(at: oldRoot, to: stagingURL)
    guard !isLink(stagingURL) else { throw MigrationError("\(context.oldData.path) copied as a link") }
    for name in ["SingletonLock", "SingletonSocket", "SingletonCookie"] {
      let lock = stagingURL.appendingPathComponent("Chromium/\(name)")
      if ownCopy(lock) { try? fm.removeItem(at: lock) }
    }
    var renamed: [String: String] = [:]
    for (old, new) in expandedRenames(in: stagingURL) {
      let from = stagingURL.appendingPathComponent(old), to = stagingURL.appendingPathComponent(new)
      guard exists(from), !exists(to), ownCopy(from), ownCopy(to) else { continue }
      try fm.moveItem(at: from, to: to)
      renamed[old] = new
    }
    let rewriter = DocumentRewriter(oldData: context.oldData.path, newData: context.newData.path, aliases: [oldRoot.path])
    var rewritten = Set<String>()
    for relative in documents(in: stagingURL) {
      let url = stagingURL.appendingPathComponent(relative)
      guard ownCopy(url), !isLink(url) else {
        log("left \(relative) as it is: it's reached through a link out of the folder")
        continue
      }
      if try rewriter.rewriteFile(url) { rewritten.insert(relative) }
    }
    return try verify(renamed: renamed, rewritten: rewritten)
  }

  func verify(renamed: [String: String], rewritten: Set<String>) throws -> Int {
    var count = 0
    let root = oldRoot
    let base = root.standardizedFileURL.path
    guard let walk = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) else {
      throw MigrationError("can't list \(base)")
    }
    for case let url as URL in walk {
      let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
      guard values.isRegularFile == true else { continue }
      var relative = String(url.standardizedFileURL.path.dropFirst(base.count + 1))
      if relative.hasPrefix("Chromium/Singleton") { continue }
      for (old, new) in renamed where relative == old || relative.hasPrefix(old + "/") {
        relative = new + relative.dropFirst(old.count)
      }
      let copy = stagingURL.appendingPathComponent(relative)
      let copied = try? copy.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
      guard copied?.isRegularFile == true else { throw MigrationError("\(relative) didn't copy") }
      if rewritten.contains(relative) {
        guard DocumentRewriter.parses(copy) else { throw MigrationError("\(relative) doesn't parse after rewriting") }
      } else if copied?.fileSize != values.fileSize {
        throw MigrationError("\(relative) copied short")
      }
      count += 1
    }
    return count
  }

  enum SecretsResult {
    case copied([String: String])
    case quit
    case startFresh
  }

  func copySecrets(_ item: Renamed.KeychainItem, from old: SecretStore, to new: SecretStore, skip: Set<String> = [],
                   keepPresent: Bool = false) -> SecretsResult {
    var results: [String: String] = [:]
    while true {
      guard let present = old.accounts(service: item.oldService) else {
        if item.critical {
          switch askAboutKey(item, "macOS couldn't list it") {
          case .copied: continue
          case let other: return other
          }
        }
        results["\(item.newService)/*"] = "failed"
        log("couldn't list \(item.oldService)")
        return .copied(results)
      }
      let accounts = (item.account.map { present.contains($0.old) ? [$0] : [] } ?? present.map { ($0, $0) }).filter { !skip.contains($0.1) }
      var retry = false
      for (oldAccount, newAccount) in accounts {
        let key = "\(item.newService)/\(newAccount)"
        let read = old.read(service: item.oldService, account: oldAccount)
        var outcome = "\(read)"
        let presentNow = keepPresent ? new.accounts(service: item.newService).map { $0.contains(newAccount) } : false
        if case .found = read, presentNow != false {
          outcome = presentNow == nil ? "failed" : "present"
        } else if case let .found(data) = read {
          let wrote = new.write(service: item.newService, account: newAccount, label: item.label(newAccount), accessible: item.accessible, data: data)
          outcome = wrote && new.read(service: item.newService, account: newAccount) == .found(data) ? "copied" : "failed"
        }
        if outcome != "copied", item.critical {
          switch askAboutKey(item, outcome) {
          case .copied:
            retry = true
          case let other: return other
          }
          break
        }
        results[key] = outcome
        if outcome != "copied" { log("\(item.oldService) (\(oldAccount)): \(outcome)") }
      }
      if !retry { return .copied(results) }
    }
  }

  private func askAboutKey(_ item: Renamed.KeychainItem, _ why: String) -> SecretsResult {
    log("\(item.oldService): \(why)")
    let choice = context.ask(
      "Ardia needs your passwords' key",
      "To keep your saved passwords and website logins, allow Ardia to use “\(item.oldService)” (the key \(LegacyName.appName) kept them with); choose Always Allow when macOS asks. Or start Ardia without \(LegacyName.appName)'s data, which stays where it is.",
      ["Try Again", "Quit", "Start Without It"])
    return choice == 0 ? .copied([:]) : choice == 2 ? .startFresh : .quit
  }

  func retrySecrets(_ journal: inout Journal) {
    guard let old = context.oldSecrets, let new = context.newSecrets else { return }
    var secrets = journal.secrets ?? [:]
    for item in Renamed.keychain where !item.critical {
      let pending = Self.accounts(of: item, in: secrets, Journal.retryable)
      guard !pending.isEmpty else { continue }
      guard let present = new.accounts(service: item.newService) else { continue }
      let done = Self.accounts(of: item, in: secrets) { !Journal.retryable($0) }
      guard case let .copied(results) = copySecrets(item, from: old, to: new, skip: done.union(present), keepPresent: true) else { continue }
      if results["\(item.newService)/*"] != nil {
        secrets.merge(results) { $1 }
        continue
      }
      for account in pending where results["\(item.newService)/\(account)"] == nil {
        secrets["\(item.newService)/\(account)"] = account == "*" ? nil : present.contains(account) ? "present" : "missing"
      }
      secrets.merge(results) { $1 }
    }
    journal.secrets = secrets
    journal.secretAttempts = (journal.secretAttempts ?? 1) + 1
  }

  static func accounts(of item: Renamed.KeychainItem, in secrets: [String: String], _ matching: (String) -> Bool) -> Set<String> {
    Set(secrets.compactMap { key, outcome in
      key.hasPrefix(item.newService + "/") && matching(outcome) ? String(key.dropFirst(item.newService.count + 1)) : nil
    })
  }

  @discardableResult
  func publish() throws -> Bool {
    if exists(stagingURL) {
      for (index, name) in try fm.contentsOfDirectory(atPath: stagingURL.path).sorted().enumerated() {
        if index == 1, crash("moved-one") { return false }
        let from = stagingURL.appendingPathComponent(name), to = context.newData.appendingPathComponent(name)
        if exists(to) {
          let aside = context.newData.appendingPathComponent(Self.asideName)
          try fm.createDirectory(at: aside, withIntermediateDirectories: true)
          try fm.moveItem(at: to, to: uniqueURL(aside.appendingPathComponent(name)))
        }
        try fm.moveItem(at: from, to: to)
      }
      MigrationFiles.syncFolder(context.newData)
      try fm.removeItem(at: stagingURL)
    }
    return true
  }

  func copyDefaults() {
    var copy: [String: Any] = [:]
    for (key, value) in context.oldDefaults.all() {
      var newKey = Renamed.defaultsKeys[key] ?? key
      for (old, new) in Renamed.defaultsKeyPrefixes where newKey.hasPrefix(old) {
        newKey = new + newKey.dropFirst(old.count)
      }
      guard !context.newDefaults.has(newKey) else { continue }
      if newKey == "NSUserKeyEquivalents", let titles = value as? [String: Any] {
        copy[newKey] = Dictionary(titles.map { title, shortcut in
          (Renamed.menuTitleWords.reduce(title) { $0.replacingOccurrences(of: $1.0, with: $1.1) }, shortcut)
        }) { first, _ in first }
      } else {
        copy[newKey] = value
      }
    }
    if !context.newDefaults.set(copy) { log("couldn't save the copied preferences") }
  }

  func moveAccessGroups() -> (state: String?, counts: Bool) {
    guard let mover = context.groupMover, !context.accessGroups.isEmpty else { return (nil, false) }
    let all = context.accessGroups.flatMap { [$0.old, $0.new] }
    guard mover.entitled(to: all) else {
      log("not entitled to the old keychain groups; Chrome's passkeys stay there until a build is")
      return ("pending", false)
    }
    var moved = 0
    var failed = false, transient = false
    for (old, new) in context.accessGroups {
      let result = mover.move(from: old, to: new)
      moved += result.moved
      if let status = result.failure {
        failed = true
        if [errSecInteractionNotAllowed, errSecNotAvailable, errSecUserCanceled].contains(status) { transient = true }
        log("moving \(old) to \(new): \(status)")
      }
    }
    return (failed ? "pending" : moved > 0 ? "moved \(moved)" : "none", failed && !transient)
  }

  @discardableResult
  func copyExtras() -> Bool {
    for (old, new) in context.extras where exists(old) && !exists(new) {
      let partial = new.deletingLastPathComponent().appendingPathComponent(".\(new.lastPathComponent).legacy-partial")
      do {
        try fm.createDirectory(at: new.deletingLastPathComponent(), withIntermediateDirectories: true)
        if exists(partial) { try fm.removeItem(at: partial) }
        try fm.copyItem(at: old, to: partial)
        if crash("extra") { return false }
        try fm.moveItem(at: partial, to: new)
      } catch {
        log("skipped \(old.lastPathComponent): \(error)")
        try? fm.removeItem(at: partial)
      }
    }
    return true
  }

  private func finish(_ journal: Journal) -> Outcome {
    var journal = journal
    if journal.outcome == "migrated" {
      copyDefaults()
      if crash("defaults") { return .quit }
      if !copyExtras() { return .quit }
      let (groups, counts) = moveAccessGroups()
      journal.groups = groups
      if counts { journal.groupAttempts = 1 }
    }
    journal.defaultBrowser = checkDefaultBrowser()
    journal.phase = "done"
    journal.finishedAt = Date()
    if !writeJournal(journal) { log("couldn't record the migration as done") }
    log("done: \(journal.outcome ?? "?")\(journal.files.map { ", \($0) files" } ?? "")")
    return .proceed
  }

  func checkDefaultBrowser() -> String? {
    guard context.oldAppWasDefaultBrowser() else { return "no" }
    let url = context.newData.appendingPathComponent(Self.defaultBrowserOfferName)
    guard !exists(url) else { return "offered" }
    let offer = try? JSONSerialization.data(withJSONObject: ["version": 1, "askedAt": NSNull()], options: [.sortedKeys])
    guard MigrationFiles.writeDurably(offer, to: url, mode: 0o644) else {
      log("couldn't record the default browser offer")
      return nil
    }
    return "offered"
  }

  private func crash(_ step: String) -> Bool { context.crashAfter == step }

  private func writeJournal(_ journal: Journal) -> Bool {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return MigrationFiles.writeDurably(try? encoder.encode(journal), to: journalURL, mode: 0o644, fullSync: true)
  }

  private func exists(_ url: URL) -> Bool {
    var info = stat()
    return lstat(url.path, &info) == 0
  }

  private func ownCopy(_ url: URL) -> Bool {
    guard let base = realpath(stagingURL.path, nil) else { return false }
    defer { free(base) }
    guard let parent = realpath(url.deletingLastPathComponent().path, nil) else { return false }
    defer { free(parent) }
    let root = String(cString: base), dir = String(cString: parent)
    return dir == root || dir.hasPrefix(root + "/")
  }

  private func isLink(_ url: URL) -> Bool {
    var info = stat()
    return lstat(url.path, &info) == 0 && info.st_mode & S_IFMT == S_IFLNK
  }

  private func hasData(_ dir: URL) -> Bool {
    exists(dir.appendingPathComponent("session.json")) || exists(dir.appendingPathComponent("Chromium/Local State"))
  }

  private func uniqueURL(_ url: URL) -> URL {
    var candidate = url, n = 2
    while exists(candidate) {
      candidate = url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent) \(n)")
      n += 1
    }
    return candidate
  }

  func expandedRenames(in root: URL) -> [(String, String)] {
    var result: [(String, String)] = []
    for (old, new) in Renamed.paths {
      let oldParts = old.split(separator: "/").map(String.init), newParts = new.split(separator: "/").map(String.init)
      guard let star = oldParts.firstIndex(of: "*") else {
        result.append((old, new))
        continue
      }
      let parent = oldParts[..<star].joined(separator: "/")
      for name in ((try? fm.contentsOfDirectory(atPath: root.appendingPathComponent(parent).path)) ?? []).sorted() {
        let fill = { (parts: [String]) in parts.map { $0 == "*" ? name : $0 }.joined(separator: "/") }
        result.append((fill(oldParts), fill(newParts)))
      }
    }
    return result
  }

  func documents(in root: URL) -> [String] {
    var result: [String] = []
    for name in ((try? fm.contentsOfDirectory(atPath: root.path)) ?? []).sorted() where name.hasSuffix(".json") {
      if (try? root.appendingPathComponent(name).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
        result.append(name)
      }
    }
    for profile in ((try? fm.contentsOfDirectory(atPath: root.appendingPathComponent("Chromium").path)) ?? []).sorted() {
      for name in ["Bookmarks", "Bookmarks.bak"] {
        let relative = "Chromium/\(profile)/\(name)"
        if (try? root.appendingPathComponent(relative).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
          result.append(relative)
        }
      }
    }
    return result
  }

  private func log(_ message: String) { NSLog("Ardia: migration from \(LegacyName.appName): \(message)") }
}

extension LegacyMigrator.Context {
  static func isDone(_ newData: URL) -> Bool {
    guard let data = try? Data(contentsOf: newData.appendingPathComponent(LegacyMigrator.journalName)) else { return false }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return (try? decoder.decode(LegacyMigrator.Journal.self, from: data))?.isDone == true
  }
}
