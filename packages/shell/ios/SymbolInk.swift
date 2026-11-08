import AppKit

enum SymbolInk {
  private static let pixelsPerPoint = 8
  private static var cache: [String: NSSize] = [:]

  static func offset(of image: NSImage?, key: String, in size: NSSize) -> NSSize {
    guard let image, size.width > 0, size.height > 0 else { return .zero }
    let cacheKey = "\(key)|\(size.width)x\(size.height)"
    if let known = cache[cacheKey] { return known }
    let measured = measure(image, in: size)
    cache[cacheKey] = measured
    return measured
  }

  private static func measure(_ image: NSImage, in size: NSSize) -> NSSize {
    let width = Int((size.width * CGFloat(pixelsPerPoint)).rounded())
    let height = Int((size.height * CGFloat(pixelsPerPoint)).rounded())
    guard width > 0, height > 0,
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let pixels = rep.bitmapData
    else { return .zero }
    rep.size = size
    memset(pixels, 0, rep.bytesPerRow * height)
    let probe = NSImageView(frame: NSRect(origin: .zero, size: size))
    probe.imageScaling = .scaleNone
    probe.contentTintColor = .black
    probe.image = image
    probe.cacheDisplay(in: probe.bounds, to: rep)
    var alpha = [UInt8](repeating: 0, count: width * height)
    for y in 0..<height {
      for x in 0..<width { alpha[y * width + x] = pixels[y * rep.bytesPerRow + x * 4 + 3] }
    }
    let shift = GlyphInk.offset(alpha: alpha, width: width, height: height, scale: Double(pixelsPerPoint))
    return NSSize(width: shift.dx, height: shift.dy)
  }
}
