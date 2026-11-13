import AppKit
import QuartzCore

final class CaptureLabel {
  private static let font = NSFont.systemFont(ofSize: 12, weight: .medium)
  private static let padX: CGFloat = 10
  private static let padY: CGFloat = 5

  let layer = CALayer()
  private let textLayer = CATextLayer()
  private var measured = NSSize.zero

  init() {
    layer.backgroundColor = NSColor.black.withAlphaComponent(0.72).cgColor
    layer.masksToBounds = true
    textLayer.font = Self.font
    textLayer.fontSize = Self.font.pointSize
    textLayer.foregroundColor = NSColor.white.cgColor
    textLayer.alignmentMode = .center
    layer.addSublayer(textLayer)
  }

  var scale: CGFloat = 2 {
    didSet {
      layer.contentsScale = scale
      textLayer.contentsScale = scale
    }
  }

  var text = "" {
    didSet {
      guard text != oldValue else { return }
      textLayer.string = text
      let line = (text as NSString).size(withAttributes: [.font: Self.font])
      measured = NSSize(width: ceil(line.width), height: ceil(line.height))
      relayout()
    }
  }

  var size: NSSize { NSSize(width: measured.width + 2 * Self.padX, height: measured.height + 2 * Self.padY) }

  private func relayout() {
    let whole = size
    layer.cornerRadius = whole.height / 2
    textLayer.frame = NSRect(x: Self.padX, y: Self.padY, width: measured.width, height: measured.height)
  }
}
