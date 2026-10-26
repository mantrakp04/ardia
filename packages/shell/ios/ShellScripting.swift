import AppKit

public enum ShellScripting {
  static let appDescription = NSScriptClassDescription(for: NSApplication.self)

  struct TabInfo {
    let id: String
    let windowId: String
    let title: String
    let url: String
    let loading: Bool
    let pinned: Bool
  }

  struct WindowInfo {
    let id: String
    let title: String
    let profileId: String
    let incognito: Bool
    let activeTabId: String?
    let tabs: [TabInfo]
  }

  struct ProfileInfo {
    let id: String
    let name: String
  }

  static var windowInfos: [WindowInfo] = []
  static var profileInfos: [ProfileInfo] = []

  static var send: (([String: Any]) -> Void)?
  private static var pending: [String: (Any?, String?) -> Void] = [:]
  private static var seq = 0

  static func setState(_ d: [String: Any]) {
    windowInfos = (d["windows"] as? [[String: Any]] ?? []).map { w in
      let id = w["id"] as? String ?? ""
      return WindowInfo(
        id: id,
        title: w["title"] as? String ?? "",
        profileId: w["profileId"] as? String ?? "",
        incognito: w["incognito"] as? Bool ?? false,
        activeTabId: w["activeTabId"] as? String,
        tabs: (w["tabs"] as? [[String: Any]] ?? []).map { t in
          TabInfo(
            id: t["id"] as? String ?? "", windowId: id, title: t["title"] as? String ?? "", url: t["url"] as? String ?? "",
            loading: t["loading"] as? Bool ?? false, pinned: t["pinned"] as? Bool ?? false)
        })
    }
    profileInfos = (d["profiles"] as? [[String: Any]] ?? []).map {
      ProfileInfo(id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "")
    }
  }

  static var orderedWindowInfos: [WindowInfo] {
    let byId = Dictionary(windowInfos.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let front = NSApp.orderedWindows.compactMap { WindowManager.shared.id(of: $0) }.compactMap { byId[$0] }
    let seen = Set(front.map(\.id))
    return front + windowInfos.filter { !seen.contains($0.id) }
  }

  static func window(_ id: String) -> WindowInfo? { windowInfos.first { $0.id == id } }

  static func tab(_ id: String) -> TabInfo? {
    for w in windowInfos { if let t = w.tabs.first(where: { $0.id == id }) { return t } }
    return nil
  }

  public static func handles(_ key: String) -> Bool {
    ["appleScriptWindows", "appleScriptProfiles", "version"].contains(key)
  }

  public static var windows: [NSObject] { orderedWindowInfos.map { ScriptWindow(id: $0.id) } }
  public static var profiles: [NSObject] { profileInfos.map { ScriptProfile(id: $0.id) } }
  public static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

  static func reply(_ id: String, result: Any?, error: String?) {
    pending.removeValue(forKey: id)?(result, error)
  }

  static func perform(_ body: [String: Any], transform: @escaping ([String: Any]) -> Any? = { _ in nil }) -> Any? {
    #if DEBUG
    if !Thread.isMainThread { NSLog("Ardia: an Apple event is being handled off the main thread") }
    #endif
    guard let send else {
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
    send(request)
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      reply(id, result: nil, error: "Ardia didn't respond in time.")
    }
    return nil
  }
}
