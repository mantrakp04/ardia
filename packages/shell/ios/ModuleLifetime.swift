import Foundation

final class ModuleLifetime {
  private static let registryLock = NSLock()
  private static var current: [ObjectIdentifier: ModuleLifetime] = [:]

  private let lock = NSRecursiveLock()
  private var alive = true
  private var teardown: (() -> Void)?

  func begin(_ module: AnyObject, teardown: @escaping () -> Void) {
    lock.lock()
    self.teardown = teardown
    lock.unlock()
    Self.registryLock.lock()
    let previous = Self.current.updateValue(self, forKey: ObjectIdentifier(type(of: module)))
    Self.registryLock.unlock()
    previous?.end()
  }

  var isAlive: Bool {
    lock.lock()
    defer { lock.unlock() }
    return alive
  }

  func run(_ body: () -> Void) {
    lock.lock()
    defer { lock.unlock() }
    if alive { body() }
  }

  func onMain(_ body: @escaping () -> Void) {
    DispatchQueue.main.async { [self] in run(body) }
  }

  func end() {
    lock.lock()
    let pending = alive ? teardown : nil
    alive = false
    teardown = nil
    lock.unlock()
    if let pending { DispatchQueue.main.async(execute: pending) }
  }
}
