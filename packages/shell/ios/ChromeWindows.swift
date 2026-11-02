import AppKit
import ArdiaCore
import ExpoModulesCore

enum ChromeWindows {
  static func makeWindow(profile: String?, chromeWindow: String? = nil, appWindow: String? = nil) -> NSWindow? {
    let profile = profile ?? ""
    installCloseHandler()
    if let appWindow {
      return ArdiaChromeWindowHost.makeWindow(forProfile: profile, chromeWindow: chromeWindow, appWindow: appWindow)
    }
    if let chromeWindow {
      return ArdiaChromeWindowHost.makeWindow(forProfile: profile, chromeWindow: chromeWindow)
    }
    return ArdiaChromeWindowHost.makeWindow(forProfile: profile)
  }

  private static var closeHandlerInstalled = false
  private static func installCloseHandler() {
    guard !closeHandlerInstalled else { return }
    closeHandlerInstalled = true
    ArdiaChromeWindowHost.shouldCloseHandler = { WindowManager.shared.windowShouldClose($0) }
    ArdiaChromeWindowHost.refusesUnhandledKeyHandler = { FocusHandoff.shared.refusesUnhandledKey($1, in: $0) }
  }

  private static let drawnMoves = LaunchConfig.shared.switchOn("sidebarSlideLean")

  static func setTrafficLightsCenter(_ center: NSPoint?, in window: NSWindow) {
    let value = center.map { NSValue(point: $0) }
    if drawnMoves {
      ArdiaChromeWindowHost.moveTrafficLightsCenter(value, in: window)
    } else {
      ArdiaChromeWindowHost.setTrafficLightsCenter(value, in: window)
    }
  }

  private static var swapHandlerInstalled = false
  static func onSwap(_ handler: @escaping (NSWindow, NSWindow) -> Void) {
    guard !swapHandlerInstalled else { return }
    swapHandlerInstalled = true
    ArdiaChromeWindowHost.swappedHandler = handler
  }
}
