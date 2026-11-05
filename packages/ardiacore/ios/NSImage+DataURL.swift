import AppKit

public extension Data {
  var pngDataURL: String { "data:image/png;base64," + base64EncodedString() }
}

public extension NSImage {
  convenience init?(dataURL: String) {
    guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ","),
      let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
    else { return nil }
    self.init(data: data)
  }

  func pngDataURL(points: CGFloat, scale: CGFloat) -> String? {
    guard let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: Int(points * scale), pixelsHigh: Int(points * scale), bitsPerSample: 8,
      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    rep.size = NSSize(width: points, height: points)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw(in: NSRect(x: 0, y: 0, width: points, height: points))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])?.pngDataURL
  }
}
