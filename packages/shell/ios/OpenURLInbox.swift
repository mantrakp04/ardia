import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public enum OpenURLInbox {
  static var pending: [String] = []
  static var pendingPointer = NSPoint.zero
  static var deliver: (([String], NSPoint) -> Void)?

  public static func receive(_ urls: [URL]) {
    let pointer = NSEvent.mouseLocation
    let strings = urls.map { $0.isFileURL ? $0.absoluteString : $0.absoluteString }
    if let deliver { return deliver(strings, pointer) }
    pending += strings
    pendingPointer = pointer
  }
}
