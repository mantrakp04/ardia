actor VaultLane {
  private var busy = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  func run<T>(_ work: @Sendable () async throws -> T) async rethrows -> T {
    await enter()
    defer { leave() }
    return try await work()
  }

  private func enter() async {
    if !busy {
      busy = true
      return
    }
    await withCheckedContinuation { waiting.append($0) }
  }

  private func leave() {
    if waiting.isEmpty {
      busy = false
    } else {
      waiting.removeFirst().resume()
    }
  }
}
