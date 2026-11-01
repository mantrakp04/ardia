import AppKit

@objc(ArdiaScriptSpace)
final class ScriptSpace: ScriptProfile {
  override var objectSpecifier: NSScriptObjectSpecifier? {
    NSUniqueIDSpecifier(containerClassDescription: ShellScripting.appDescription!, containerSpecifier: nil, key: "appleScriptSpaces", uniqueID: uniqueID)
  }

  override func handleFocusScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "focusSpace", "spaceId": uniqueID])
  }
}
