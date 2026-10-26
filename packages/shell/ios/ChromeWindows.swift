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

  static func takeDismissed(appWindow: String) -> Bool {
    ArdiaChromeWindowHost.takeDismissedAppWindow(appWindow)
  }

  static func fullScreenIsForPage(_ window: NSWindow) -> Bool {
    ArdiaChromeWindowHost.windowFullScreenIs(forPage: window)
  }

  static func forgetLaunchPictures() {
    ArdiaChromeWindowHost.forgetLaunchPictures()
  }

  static func recordLaunchLayout() {
    ArdiaChromeWindowHost.recordLaunchLayout()
  }

  static func embed(_ root: NSView, in window: NSWindow) {
    ArdiaChromeWindowHost.embedRootView(root, in: window)
  }

  static func root(of window: NSWindow) -> NSView? {
    ArdiaChromeWindowHost.rootView(of: window)
  }

  static func close(_ window: NSWindow) {
    ArdiaChromeWindowHost.close(window)
  }

  static func showProfile(_ profile: String, in window: NSWindow) {
    ArdiaChromeWindowHost.showProfile(profile, in: window)
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

  static func prepare(_ profiles: [String], for window: NSWindow) {
    guard !profiles.isEmpty else { return }
    ArdiaChromeWindowHost.prepareProfiles(profiles, for: window)
  }

  private static var swapHandlerInstalled = false
  static func onSwap(_ handler: @escaping (NSWindow, NSWindow) -> Void) {
    guard !swapHandlerInstalled else { return }
    swapHandlerInstalled = true
    ArdiaChromeWindowHost.swappedHandler = handler
  }

  static func removeRoot(of window: NSWindow) {
    ArdiaChromeWindowHost.removeRootView(of: window)
  }
}
