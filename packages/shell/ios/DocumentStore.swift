import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

enum DocumentStore {
  typealias Done = (Error?) -> Void
  private struct Staged {
    let url: URL
    let generation: UInt64
    let contents: String
    var waiters: [Done]
  }

  private static let queue = DispatchQueue(label: "ardia.documents", qos: .utility)
  private static let lock = NSLock()
  private static var staged: [String: Staged] = [:]
  private static var generation: UInt64 = 0
  private static var closed = false
  private static let flushOnQuit = NotificationCenter.default.addObserver(
    forName: NSApplication.willTerminateNotification, object: nil, queue: nil
  ) { _ in flush() }

  static func url(_ name: String) throws -> URL {
    let dir: URL
    if let custom = LaunchConfig.shared.dataDirectory {
      dir = URL(fileURLWithPath: custom, isDirectory: true)
    } else {
      let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      dir = base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Ardia", isDirectory: true)
    }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent((name as NSString).lastPathComponent)
  }

  static func read(_ name: String) -> String? {
    guard let url = try? url(name) else { return nil }
    lock.lock()
    let pending = staged[url.lastPathComponent]?.contents
    lock.unlock()
    return pending ?? (try? String(contentsOf: url, encoding: .utf8))
  }

  static func write(_ name: String, _ contents: String, done: Done? = nil) throws {
    _ = flushOnQuit
    let url = try url(name)
    let key = url.lastPathComponent
    lock.lock()
    if closed {
      lock.unlock()
      done?(CocoaError(.fileWriteNoPermission))
      return
    }
    generation += 1
    let mine = generation
    staged[key] = Staged(url: url, generation: mine, contents: contents, waiters: (staged[key]?.waiters ?? []) + (done.map { [$0] } ?? []))
    lock.unlock()
    queue.async { land(key, mine, attempt: 0) }
  }

  static func remove(_ name: String) throws {
    let url = try url(name)
    lock.lock()
    if closed { return lock.unlock() }
    generation += 1
    let waiters = staged.removeValue(forKey: url.lastPathComponent)?.waiters ?? []
    lock.unlock()
    queue.async {
      try? FileManager.default.removeItem(at: url)
      for waiter in waiters { waiter(nil) }
    }
  }

  private static func land(_ key: String, _ generation: UInt64, attempt: Int) {
    lock.lock()
    guard let save = staged[key], save.generation == generation else { return lock.unlock() }
    lock.unlock()
    var failure: Error?
    do {
      try save.contents.write(to: save.url, atomically: true, encoding: .utf8)
    } catch {
      failure = error
    }
    lock.lock()
    var waiters: [Done] = []
    if staged[key]?.generation == generation {
      waiters = staged[key]!.waiters
      if failure == nil { staged[key] = nil } else { staged[key]!.waiters = [] }
    }
    lock.unlock()
    for waiter in waiters { waiter(failure) }
    guard let failure else { return }
    NSLog("Ardia: saving \(key) failed (try \(attempt + 1)): \(failure.localizedDescription)")
    let delay = min(60.0, 2.0 * pow(2.0, Double(min(attempt, 5))))
    queue.asyncAfter(deadline: .now() + delay) { land(key, generation, attempt: attempt + 1) }
  }

  static func close() {
    lock.lock()
    closed = true
    lock.unlock()
  }

  @discardableResult
  static func flush() -> Bool {
    queue.sync {
      lock.lock()
      let keys = Array(staged.keys)
      lock.unlock()
      for key in keys {
        lock.lock()
        let generation = staged[key]?.generation
        lock.unlock()
        if let generation { land(key, generation, attempt: 99) }
      }
    }
    lock.lock()
    defer { lock.unlock() }
    return staged.isEmpty
  }
}
