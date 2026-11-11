import Foundation

@MainActor
final class SharedWork<Key: Hashable, Value: Sendable> {
  private struct Running {
    let task: Task<Value?, Never>
    var owners: Set<String>
  }

  private var running: [Key: Running] = [:]
  private var cancelled: Set<String> = []
  private var cancelOrder: [String] = []
  private let cancelsKept = 256

  var count: Int { running.count }

  func value(for key: Key, owner: String, start: @escaping @MainActor () async -> Value?) async -> Value? {
    guard !cancelled.contains(owner) else { return nil }
    if var shared = running[key] {
      shared.owners.insert(owner)
      running[key] = shared
      return await shared.task.value
    }
    let task = Task { @MainActor in await start() }
    running[key] = Running(task: task, owners: [owner])
    let value = await task.value
    if running[key]?.task == task { running[key] = nil }
    return value
  }

  func cancel(owner: String) {
    if cancelled.insert(owner).inserted {
      cancelOrder.append(owner)
      if cancelOrder.count > cancelsKept { cancelled.remove(cancelOrder.removeFirst()) }
    }
    for (key, var shared) in running where shared.owners.contains(owner) {
      shared.owners.remove(owner)
      if shared.owners.isEmpty {
        shared.task.cancel()
        running[key] = nil
      } else {
        running[key] = shared
      }
    }
  }
}
