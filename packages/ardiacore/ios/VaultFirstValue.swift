import Foundation

final class VaultFirstValue: @unchecked Sendable {
  private let lock = NSLock()
  private var settled = false
  private var value: String?
  private var waiter: CheckedContinuation<String?, Never>?

  func offer(_ candidate: String?) {
    lock.lock()
    if settled {
      lock.unlock()
      return
    }
    settled = true
    value = candidate
    let waiter = self.waiter
    self.waiter = nil
    lock.unlock()
    waiter?.resume(returning: candidate)
  }

  func wait(timeout: TimeInterval) async -> String? {
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout) { self.offer(nil) }
    return await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
      lock.lock()
      if settled {
        let value = self.value
        lock.unlock()
        continuation.resume(returning: value)
      } else {
        waiter = continuation
        lock.unlock()
      }
    }
  }
}
