import AppKit
import CoreImage
import ExpoModulesCore

enum GlassGlow {
  private static let cache = NSCache<NSString, CGImage>()

  static func of(_ source: IconSource, blurred: CGImage) -> CGImage? {
    if let cached = cache.object(forKey: source.key as NSString) { return cached }
    let scale = min(1, 64 / Double(max(blurred.width, blurred.height, 1)))
    let w = max(1, Int(Double(blurred.width) * scale)), h = max(1, Int(Double(blurred.height) * scale))
    guard let context = CGContext(
      data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let data = context.data
    else { return nil }
    context.draw(blurred, in: CGRect(x: 0, y: 0, width: w, height: h))
    let bytes = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
    for i in stride(from: 0, to: w * h * 4, by: 4) {
      let a = Double(bytes[i + 3]) / 255
      guard a > 0 else { continue }
      let (rgb, strength) = glow(SIMD3(Double(bytes[i]), Double(bytes[i + 1]), Double(bytes[i + 2])) / 255 / a)
      let alpha = a * strength
      for k in 0..<3 { bytes[i + k] = UInt8((rgb[k] * alpha * 255).rounded()) }
      bytes[i + 3] = UInt8((alpha * 255).rounded())
    }
    guard let image = context.makeImage() else { return nil }
    cache.setObject(image, forKey: source.key as NSString)
    return image
  }

  static func of(_ color: NSColor) -> CGColor? {
    guard let c = color.usingColorSpace(.sRGB) else { return nil }
    let (rgb, strength) = glow(SIMD3(Double(c.redComponent), Double(c.greenComponent), Double(c.blueComponent)))
    return strength > 0 ? CGColor(srgbRed: rgb.x, green: rgb.y, blue: rgb.z, alpha: strength) : nil
  }

  private static func glow(_ rgb: SIMD3<Double>) -> (SIMD3<Double>, Double) {
    let top = rgb.max(), chroma = top - rgb.min()
    guard top > 0 else { return (.zero, 0) }
    let bright = rgb / top
    return (bright + (SIMD3(repeating: 1) - bright) * 0.35, min(1, chroma * 1.5))
  }
}
