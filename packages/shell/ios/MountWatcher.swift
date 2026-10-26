import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class MountWatcher: NSObject {
  @objc func uiManagerDidPerformMounting(_ manager: AnyObject) {
    DispatchQueue.main.async { ServerWindowDrag.scheduleRefreshAll() }
  }
}
