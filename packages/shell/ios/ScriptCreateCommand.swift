import AppKit

@objc(ArdiaScriptCreateCommand)
final class ScriptCreateCommand: NSCreateCommand {
  override func performDefaultImplementation() -> Any? {
    let properties = resolvedKeyDictionary
    let url = properties["URL"] as? String
    switch createClassDescription.className {
    case "window":
      var body: [String: Any] = ["command": "newWindow", "incognito": properties["incognito"] as? Bool ?? false]
      if let url { body["url"] = url }
      if let profile = properties["activeProfile"] as? ScriptProfile { body["profileId"] = profile.uniqueID }
      return ShellScripting.perform(body) { ($0["windowId"] as? String).flatMap { ScriptWindow(id: $0).objectSpecifier } }
    case "tab":
      var body: [String: Any] = ["command": "newTab"]
      if let url { body["url"] = url }
      let location = arguments?["Location"] as? NSPositionalSpecifier
      if let window = (location?.insertionContainer as? ScriptWindow) ?? ShellScripting.orderedWindowInfos.first.map({ ScriptWindow(id: $0.id) }) {
        body["windowId"] = window.uniqueID
        if let index = location?.insertionIndex, index >= 0 { body["index"] = index }
      }
      return ShellScripting.perform(body) { ($0["tabId"] as? String).flatMap { ScriptTab(id: $0).objectSpecifier } }
    default:
      setError("Ardia can't make a new \(createClassDescription.className).")
      return nil
    }
  }
}
