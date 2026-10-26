import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class VisualEffect: ExpoView {
  let effect = NSVisualEffectView()
  var cornerRadius: Double = 0 { didSet { applyCorners() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    effect.state = .active
    effect.blendingMode = .withinWindow
    effect.material = .hudWindow
    effect.wantsLayer = true
    addSubview(effect)
  }

  func setMaterial(_ name: String) {
    let materials: [String: NSVisualEffectView.Material] = [
      "hudWindow": .hudWindow, "popover": .popover, "menu": .menu, "sidebar": .sidebar,
      "headerView": .headerView, "sheet": .sheet, "windowBackground": .windowBackground,
      "underWindowBackground": .underWindowBackground, "contentBackground": .contentBackground,
      "fullScreenUI": .fullScreenUI, "toolTip": .toolTip, "titlebar": .titlebar, "selection": .selection,
    ]
    effect.material = materials[name] ?? .hudWindow
  }

  private func applyCorners() {
    effect.layer?.cornerRadius = cornerRadius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = cornerRadius > 0
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    applyCorners()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
