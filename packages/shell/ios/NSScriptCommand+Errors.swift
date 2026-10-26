import AppKit

extension NSScriptCommand {
  func setError(_ message: String) {
    scriptErrorNumber = -10000
    scriptErrorString = message
  }

  func refuseJavaScriptFromAppleEvents() {
    scriptErrorNumber = 12
    scriptErrorString =
      "Executing JavaScript through AppleScript is turned off. To turn it on, from the menu bar, go to View > Developer > Allow JavaScript from Apple Events."
  }
}
