import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public enum ShellApp {
  public static func shouldTerminate() -> NSApplication.TerminateReply { QuitFlow.shared.shouldTerminate() }
  public static func reopen(hasVisibleWindows: Bool) -> Bool {
    if !hasVisibleWindows { WindowManager.shared.reopen() }
    return true
  }
  public static func dockMenu() -> NSMenu { MainMenu.dockMenu() }
}
