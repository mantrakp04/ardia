import AppKit
import ArdiaCore
import ExpoModulesCore

final class WindowProfileView: ExpoView {
  var profile = ""
  var neighbours: [String] = []
  var selection = ""
  private var applied: (profile: String, neighbours: [String], selection: String)?
  private var observer: CFRunLoopObserver?

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { scheduleSwap() }
  }

  func scheduleSwap() {
    guard observer == nil else { return }
    let observer = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.beforeWaiting.rawValue, false, 0) { [weak self] _, _ in
      self?.observer = nil
      self?.apply()
    }
    self.observer = observer
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
  }

  private func apply() {
    guard let window else { return }
    if applied?.profile != profile { ChromeWindows.showProfile(profile, in: window) }
    if let applied, applied.profile != profile || applied.selection != selection {
      NotificationCenter.default.post(name: .ardiaPagerActivity, object: window)
    }
    if applied?.neighbours != neighbours, let current = self.window { ChromeWindows.prepare(neighbours, for: current) }
    applied = (profile, neighbours, selection)
  }
}
