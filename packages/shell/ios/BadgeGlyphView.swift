import AppKit
import CoreText
import ExpoModulesCore

final class BadgeGlyphView: ExpoView {
  var text = "" { didSet { updateImage() } }
  var initial = false { didSet { updateImage() } }
  var fontSize: Double = 14 { didSet { updateImage() } }
  var color: NSColor = .white { didSet { updateImage() } }

  private let imageView = NSImageView()
  private let rasterScale: CGFloat = 4
  private static let images: NSCache<NSString, NSImage> = {
    let cache = NSCache<NSString, NSImage>()
    cache.countLimit = 128
    cache.totalCostLimit = 4 * 1024 * 1024
    return cache
  }()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleAxesIndependently
    imageView.imageAlignment = .alignCenter
    imageView.autoresizingMask = [.width, .height]
    addSubview(imageView)
    updateImage()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    let changed = frame.size != newSize
    super.setFrameSize(newSize)
    guard changed else { return }
    imageView.frame = bounds
    updateImage()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    updateImage()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    updateImage()
  }

  private func updateImage() {
    guard bounds.width > 0, bounds.height > 0, fontSize.isFinite,
      let tint = color.usingColorSpace(.deviceRGB) else {
      imageView.image = nil
      return
    }
    let content = initial
      ? text.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?"
      : text
    let pointSize = min(256, max(1, fontSize))
    let backingScale = window?.backingScaleFactor ?? 2
    let pixelWidth = ceil(bounds.width * backingScale)
    let pixelHeight = ceil(bounds.height * backingScale)
    guard !content.isEmpty, pixelWidth.isFinite, pixelHeight.isFinite,
      pixelWidth <= 4096, pixelHeight <= 4096 else {
      imageView.image = nil
      return
    }
    let components: [CGFloat] = [CGFloat(pointSize), tint.redComponent, tint.greenComponent, tint.blueComponent, tint.alphaComponent,
      bounds.width, bounds.height, backingScale]
    let key = "\(content.utf16.count):\(content)|" + components.map { String(describing: $0) }.joined(separator: "|")
    let cacheKey = key as NSString
    var image = Self.images.object(forKey: cacheKey)
    if image == nil, let rendered = renderImage(content, pointSize: pointSize, tint: tint, backingScale: backingScale) {
      Self.images.setObject(rendered, forKey: cacheKey, cost: Int(pixelWidth * pixelHeight) * 4)
      image = rendered
    }
    if imageView.image !== image { imageView.image = image }
  }

  private func renderImage(_ content: String, pointSize: Double, tint: NSColor, backingScale: CGFloat) -> NSImage? {
    guard let glyph = renderGlyph(content, pointSize: pointSize, tint: tint) else { return nil }
    let pixelWidth = ceil(bounds.width * backingScale)
    let pixelHeight = ceil(bounds.height * backingScale)
    let width = Int(pixelWidth)
    let height = Int(pixelHeight)
    guard let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    let inkWidth = CGFloat(glyph.width) / rasterScale * backingScale
    let inkHeight = CGFloat(glyph.height) / rasterScale * backingScale
    let scale = min(1, pixelWidth / inkWidth, pixelHeight / inkHeight)
    let rect = CGRect(
      x: (pixelWidth - inkWidth * scale) / 2,
      y: (pixelHeight - inkHeight * scale) / 2,
      width: inkWidth * scale,
      height: inkHeight * scale
    )
    context.interpolationQuality = .high
    context.draw(glyph, in: rect)
    guard let canvas = context.makeImage() else { return nil }
    return NSImage(cgImage: canvas, size: bounds.size)
  }

  private func renderGlyph(_ content: String, pointSize: Double, tint: NSColor) -> CGImage? {
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: pointSize, weight: .semibold),
      .foregroundColor: tint,
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: content, attributes: attributes))
    let ink = CTLineGetImageBounds(line, nil)
    guard !ink.isEmpty, !ink.isInfinite, !ink.isNull else { return nil }
    let padding = ceil(pointSize * rasterScale)
    let rasterWidth = ceil(ink.width * rasterScale) + padding * 2
    let rasterHeight = ceil(ink.height * rasterScale) + padding * 2
    guard rasterWidth.isFinite, rasterHeight.isFinite, rasterWidth <= 4096, rasterHeight <= 4096 else { return nil }
    let width = Int(rasterWidth)
    let height = Int(rasterHeight)
    guard let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ), let data = context.data else { return nil }
    context.scaleBy(x: rasterScale, y: rasterScale)
    context.textMatrix = .identity
    context.textPosition = CGPoint(x: padding / rasterScale - ink.minX, y: padding / rasterScale - ink.minY)
    CTLineDraw(line, context)
    let bytes = data.assumingMemoryBound(to: UInt8.self)
    var minX = width, minY = height, maxX = -1, maxY = -1
    for y in 0..<height {
      for x in 0..<width where bytes[y * context.bytesPerRow + x * 4 + 3] > 0 {
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
      }
    }
    guard maxX >= minX, maxY >= minY else { return nil }
    return context.makeImage()?.cropping(to: CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1))
  }
}
