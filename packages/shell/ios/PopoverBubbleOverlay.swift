import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class PopoverBubbleOverlay: NSView {
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
