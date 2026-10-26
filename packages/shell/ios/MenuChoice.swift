import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class MenuChoice: NSObject {
  var chosen: String?
  @objc func choose(_ sender: NSMenuItem) { chosen = sender.representedObject as? String }
}
