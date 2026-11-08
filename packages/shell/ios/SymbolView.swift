import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class SymbolView: ExpoView {
  private let imageView = NSImageView()
  var name = "questionmark" { didSet { update() } }
  var pointSize: Double = 14 { didSet { update() } }
  var weight = "regular" { didSet { update() } }
  var centerInk = false { didSet { layoutImage() } }
  var tint: NSColor? { didSet { imageView.contentTintColor = tint } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleNone
    imageView.autoresizingMask = [.width, .height]
    addSubview(imageView)
    update()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    layoutImage()
  }

  private func layoutImage() {
    let shift = centerInk ? SymbolInk.offset(of: imageView.image, key: "\(name)|\(pointSize)|\(weight)", in: bounds.size) : .zero
    imageView.frame = bounds.offsetBy(dx: shift.width, dy: isFlipped ? shift.height : -shift.height)
  }

  private func update() {
    let weights: [String: NSFont.Weight] = [
      "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold,
    ]
    let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weights[weight] ?? .regular)
    imageView.image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config)
    layoutImage()
  }
}
