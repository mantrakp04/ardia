import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

enum ThinScrollBars {
  private static var thin = false
  private static var installed = false
  private static let selector = #selector(getter: NSScroller.preferredScrollerStyle)

  static func set(_ on: Bool) {
    guard on != thin else { return }
    if on { install() }
    guard installed else { return }
    thin = on
    NotificationCenter.default.post(name: NSScroller.preferredScrollerStyleDidChangeNotification, object: nil)
  }

  private static func install() {
    guard !installed, let method = class_getClassMethod(NSScroller.self, selector) else { return }
    typealias Preferred = @convention(c) (AnyClass, Selector) -> Int
    let system = unsafeBitCast(method_getImplementation(method), to: Preferred.self)
    let preferred: @convention(block) (AnyClass) -> Int = { scroller in
      thin ? NSScroller.Style.overlay.rawValue : system(scroller, selector)
    }
    method_setImplementation(method, imp_implementationWithBlock(preferred))
    installed = true
  }
}
