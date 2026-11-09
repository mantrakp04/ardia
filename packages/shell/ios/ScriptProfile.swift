import AppKit

@objc(ArdiaScriptProfile)
final class ScriptProfile: NSObject {
  @objc let uniqueID: String

  init(id: String) {
    uniqueID = id
  }

  override var objectSpecifier: NSScriptObjectSpecifier? {
    NSUniqueIDSpecifier(containerClassDescription: ShellScripting.appDescription!, containerSpecifier: nil, key: "appleScriptProfiles", uniqueID: uniqueID)
  }

  @objc var name: String { ShellScripting.state.profiles.first { $0.id == uniqueID }?.name ?? "" }
  @objc var orderedIndex: Int { (ShellScripting.state.profiles.firstIndex { $0.id == uniqueID } ?? -1) + 1 }

  @objc var appleScriptTabs: [ScriptTab] {
    ShellScripting.orderedWindows.filter { $0.profileId == uniqueID }.flatMap { $0.tabs.map { ScriptTab(id: $0.id) } }
  }

  @objc func handleFocusScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "focusProfile", "profileId": uniqueID])
  }
}
