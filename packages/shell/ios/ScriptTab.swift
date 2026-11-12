import AppKit

@objc(ArdiaScriptTab)
final class ScriptTab: NSObject {
  @objc let uniqueID: String

  init(id: String) {
    uniqueID = id
  }

  private var found: (window: ScriptWindowState, tab: ScriptTabState)? { ShellScripting.tab(uniqueID) }
  private var info: ScriptTabState? { found?.tab }

  override var objectSpecifier: NSScriptObjectSpecifier? {
    guard let windowId = found?.window.id else { return nil }
    let window = ScriptWindow(id: windowId)
    return NSUniqueIDSpecifier(
      containerClassDescription: NSScriptClassDescription(for: ScriptWindow.self)!, containerSpecifier: window.objectSpecifier,
      key: "appleScriptTabs", uniqueID: uniqueID)
  }

  @objc var title: String { info?.title ?? "" }
  @objc var loading: Bool { info?.loading ?? false }
  @objc var isPinned: Bool { info?.pinned ?? false }
  @objc var isFocused: Bool {
    found?.window.activeTabId == uniqueID
  }

  @objc(URL) var scriptURL: String {
    get { info?.url ?? "" }
    set { _ = ShellScripting.perform(["command": "setURL", "tabId": uniqueID, "url": newValue]) }
  }

  @objc func handleCloseScriptCommand(_ command: NSCloseCommand) -> Any? {
    ShellScripting.perform(["command": "closeTab", "tabId": uniqueID])
  }

  @objc func handleReloadScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "reload", "tabId": uniqueID])
  }

  @objc func handleGoBackScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "back", "tabId": uniqueID])
  }

  @objc func handleGoForwardScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "forward", "tabId": uniqueID])
  }

  @objc func handleFocusScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "focusTab", "tabId": uniqueID])
  }

  @objc func handleExecuteScriptCommand(_ command: NSScriptCommand) -> Any? {
    guard let code = command.evaluatedArguments?["javascript"] as? String else {
      command.setError("Missing the “javascript” parameter.")
      return nil
    }
    return ShellScripting.perform(["command": "execute", "tabId": uniqueID, "code": code]) { $0["value"] as? String ?? "" }
  }
}
