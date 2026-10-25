import ExpoModulesCore

public class ChromeUIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaChromeUI")
    Events("onDeviceChooser", "onCastDialog", "onCastRoutes", "onSidePanel", "onActionPopup", "onActionShortcut")

    OnCreate {
      ArdiaCoreHost.chromeUIHandler = { [weak self] name, payload in
        switch name {
        case "sidePanel": self?.sendEvent("onSidePanel", payload)
        case "actionPopup": self?.sendEvent("onActionPopup", payload)
        case "actionShortcut": self?.sendEvent("onActionShortcut", payload)
        case "deviceChooser": self?.sendEvent("onDeviceChooser", payload)
        case "castDialog": self?.sendEvent("onCastDialog", payload)
        case "castRoutes": self?.sendEvent("onCastRoutes", payload)
        default: break
        }
      }
    }

    AsyncFunction("selectDevice") { (id: Int, index: Int) in ArdiaCoreHost.deviceChooser(Int32(id), select: Int32(index)) }.runOnQueue(.main)
    AsyncFunction("cancelDeviceChooser") { (id: Int) in ArdiaCoreHost.deviceChooser(Int32(id), action: "cancel") }.runOnQueue(.main)
    AsyncFunction("refreshDeviceChooser") { (id: Int) in ArdiaCoreHost.deviceChooser(Int32(id), action: "refresh") }.runOnQueue(.main)
    AsyncFunction("openBluetoothSettings") { (id: Int) in ArdiaCoreHost.deviceChooser(Int32(id), action: "settings") }.runOnQueue(.main)
    AsyncFunction("devShowBluetoothChooser") { (browserId: Int, unauthorized: Bool) -> Bool in
      ArdiaCoreHost.devShowBluetoothChooser(browserId: Int32(browserId), unauthorized: unauthorized)
    }.runOnQueue(.main)
    AsyncFunction("devChooserEvents") { ArdiaCoreHost.testChooserEvents() }.runOnQueue(.main)

    AsyncFunction("showCastDialog") { (browserId: Int) in ArdiaCoreHost.showCastDialog(browserId: Int32(browserId)) }.runOnQueue(.main)
    AsyncFunction("startCasting") { (id: Int, sink: String, mode: Int) in
      ArdiaCoreHost.castDialog(Int32(id), start: sink, mode: Int32(mode))
    }.runOnQueue(.main)
    AsyncFunction("stopCasting") { (id: Int, route: String) in ArdiaCoreHost.castDialog(Int32(id), stop: route) }.runOnQueue(.main)
    AsyncFunction("closeCastDialog") { (id: Int) in ArdiaCoreHost.closeCastDialog(Int32(id)) }.runOnQueue(.main)
    AsyncFunction("watchCastRoutes") { (profile: String) in ArdiaCoreHost.watchCastRoutes(profile) }.runOnQueue(.main)
    AsyncFunction("terminateCastRoute") { (route: String) in ArdiaCoreHost.terminateCastRoute(route) }.runOnQueue(.main)

    AsyncFunction("actionStates") { (browserId: Int, ids: [String]) in
      ArdiaCoreHost.actionStates(browserId: Int32(browserId), extensions: ids)
    }.runOnQueue(.main)
    AsyncFunction("sidePanelURL") { (browserId: Int, extensionId: String) -> String? in
      ArdiaCoreHost.sidePanelURL(browserId: Int32(browserId), extension: extensionId)
    }.runOnQueue(.main)

    AsyncFunction("changeCaptureSource") { (capturer: Int, target: Int) -> Bool in
      ArdiaCoreHost.shareTabInstead(capturer: Int32(capturer), target: Int32(target))
    }.runOnQueue(.main)
    AsyncFunction("stopCapture") { (capturer: Int) in ArdiaCoreHost.stopCapture(browserId: Int32(capturer)) }.runOnQueue(.main)
    AsyncFunction("showAutofillSuggestions") { (browserId: Int, passwords: Bool) in
      ArdiaCoreHost.showAutofillSuggestions(browserId: Int32(browserId), passwords: passwords)
    }.runOnQueue(.main)
    AsyncFunction("showAppleAutoFill") { (browserId: Int, kind: String) -> Bool in
      ArdiaCoreHost.showAppleAutoFill(browserId: Int32(browserId), kind: kind)
    }.runOnQueue(.main)
  }
}
