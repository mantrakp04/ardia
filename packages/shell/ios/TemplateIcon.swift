import AppKit
import CoreImage
import ExpoModulesCore

enum TemplateIcon {
  private static let cache = NSCache<NSString, CGImage>()

  static func of(_ source: IconSource) -> CGImage? {
    if let cached = cache.object(forKey: source.key as NSString) { return cached }
    guard let image = source.load(),
      let context = CGContext(
        data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let rect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    context.draw(image, in: rect)
    context.setBlendMode(.sourceIn)
    context.setFillColor(.white)
    context.fill(rect)
    guard let white = context.makeImage() else { return nil }
    cache.setObject(white, forKey: source.key as NSString)
    return white
  }
}
