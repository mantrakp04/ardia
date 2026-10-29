import AppKit

@objc(ArdiaScriptWindow)
final class ScriptWindow: NSObject {
  @objc let uniqueID: String

  init(id: String) {
    uniqueID = id
  }

  private var info: ScriptWindowState? { ShellScripting.window(uniqueID) }
  private var nsWindow: NSWindow? { WindowManager.shared.window(uniqueID) }

  override var objectSpecifier: NSScriptObjectSpecifier? {
    NSUniqueIDSpecifier(containerClassDescription: ShellScripting.appDescription!, containerSpecifier: nil, key: "appleScriptWindows", uniqueID: uniqueID)
  }

  @objc var name: String { info?.title ?? "" }
  @objc var orderedIndex: Int { (ShellScripting.orderedWindows.firstIndex { $0.id == uniqueID } ?? -1) + 1 }
  @objc var incognito: Bool { info?.incognito ?? false }
  @objc var appleScriptTabs: [ScriptTab] { info?.tabs.map { ScriptTab(id: $0.id) } ?? [] }
  @objc var activeTab: ScriptTab? { info?.activeTabId.map(ScriptTab.init(id:)) }
  @objc var URL: String { info.flatMap { i in i.tabs.first { $0.id == i.activeTabId }?.url } ?? "" }
  @objc var activeProfile: ScriptProfile? {
    guard let info, !info.incognito else { return nil }
    return ScriptProfile(id: info.profileId)
  }

  @objc func valueInAppleScriptTabsWithUniqueID(_ id: String) -> ScriptTab? {
    info?.tabs.contains { $0.id == id } == true ? ScriptTab(id: id) : nil
  }

  @objc var activeTabIndex: Int {
    get { (info?.tabs.firstIndex { $0.id == info?.activeTabId } ?? -1) + 1 }
    set { _ = ShellScripting.perform(["command": "setActiveTabIndex", "windowId": uniqueID, "index": newValue]) }
  }

  @objc var isVisible: Bool { nsWindow?.isVisible ?? false }
  @objc var isMiniaturized: Bool {
    get { nsWindow?.isMiniaturized ?? false }
    set { newValue ? nsWindow?.miniaturize(nil) : nsWindow?.deminiaturize(nil) }
  }
  @objc var isZoomed: Bool {
    get { nsWindow?.isZoomed ?? false }
    set { if newValue != nsWindow?.isZoomed { nsWindow?.zoom(nil) } }
  }

  @objc func handleCloseScriptCommand(_ command: NSCloseCommand) -> Any? {
    ShellScripting.perform(["command": "closeWindow", "windowId": uniqueID])
  }
}
