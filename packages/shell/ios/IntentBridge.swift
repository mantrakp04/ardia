import Foundation

@MainActor
enum IntentBridge {
  static func ready() async throws {
    for _ in 0..<200 {
      if ShellEvents.isAttached(.scriptCommand) && ShellEvents.isAttached(.openURLs) { return }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw IntentError.notReady
  }

  static func run(_ body: [String: Any]) async throws -> [String: Any] {
    try await ready()
    return try await withCheckedThrowingContinuation { continuation in
      let sent = ShellScripting.dispatch(body) { result, error in
        if let error { continuation.resume(throwing: IntentError.app(error)) }
        else { continuation.resume(returning: result as? [String: Any] ?? [:]) }
      }
      if !sent { continuation.resume(throwing: IntentError.notReady) }
    }
  }

  static var regularWindows: [ScriptWindowState] { ShellScripting.orderedWindows.filter { !$0.incognito } }

  static var regularTabs: [ScriptTabState] { regularWindows.flatMap { $0.tabs + $0.otherProfilesTabs } }

  static func tab(_ id: String) throws -> ScriptTabState {
    guard let tab = regularTabs.first(where: { $0.id == id }) else { throw IntentError.tabClosed }
    return tab
  }
}
