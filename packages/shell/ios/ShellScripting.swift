import AppKit

public enum ShellScripting {
  static let appDescription = NSScriptClassDescription(for: NSApplication.self)

  static var state = ScriptState()

  private static var pending: [String: (Any?, String?) -> Void] = [:]
  private static var seq = 0

  static var orderedWindows: [ScriptWindowState] {
    let byId = Dictionary(state.windows.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let front = NSApp.orderedWindows.compactMap { WindowManager.shared.id(of: $0) }.compactMap { byId[$0] }
    let seen = Set(front.map(\.id))
    return front + state.windows.filter { !seen.contains($0.id) }
  }

  static func window(_ id: String) -> ScriptWindowState? { state.windows.first { $0.id == id } }

  static func tab(_ id: String) -> (window: ScriptWindowState, tab: ScriptTabState)? {
    for window in state.windows { if let tab = window.tabs.first(where: { $0.id == id }) { return (window, tab) } }
    return nil
  }

  public static func handles(_ key: String) -> Bool {
    ["appleScriptWindows", "appleScriptProfiles", "version"].contains(key)
  }

  public static var windows: [NSObject] { orderedWindows.map { ScriptWindow(id: $0.id) } }
  public static var profiles: [NSObject] { state.profiles.map { ScriptProfile(id: $0.id) } }
  public static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

  static func reply(_ id: String, result: Any?, error: String?) {
    pending.removeValue(forKey: id)?(result, error)
  }

  static func perform(_ body: [String: Any], transform: @escaping ([String: Any]) -> Any? = { _ in nil }) -> Any? {
    #if DEBUG
    if !Thread.isMainThread { NSLog("Ardia: an Apple event is being handled off the main thread") }
    #endif
    guard ShellEvents.isAttached(.scriptCommand) else {
      NSScriptCommand.current()?.setError("Ardia isn't ready yet.")
      return nil
    }
    seq += 1
    let id = "as-\(seq)"
    let command = NSScriptCommand.current()
    command?.suspendExecution()
    var finished = false
    pending[id] = { result, error in
      guard !finished else { return }
      finished = true
      let answer = result as? [String: Any] ?? [:]
      let refused = error == nil && answer["refused"] as? String == "javaScriptFromAppleEvents"
      if let error { command?.setError(error) }
      if refused { command?.refuseJavaScriptFromAppleEvents() }
      let value = error == nil && !refused ? transform(answer) : nil
      if let failure = ArdiaTryCatch({ command?.resumeExecution(withResult: value) }) {
        NSLog("Ardia: AppleScript reply failed: \(failure)")
      }
    }
    var request = body
    request["id"] = id
    ShellEvents.send(.scriptCommand, request)
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      reply(id, result: nil, error: "Ardia didn't respond in time.")
    }
    return nil
  }
}
