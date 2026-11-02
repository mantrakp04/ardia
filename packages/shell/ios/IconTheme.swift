import AppKit
import CoreImage
import ExpoModulesCore

enum IconTheme {
  case blur
  case template(fill: CGColor, stroke: CGColor?)

  var json: [String: Any] {
    switch self {
    case .blur:
      return ["kind": "blur"]
    case let .template(fill, stroke):
      var out: [String: Any] = ["kind": "template", "fill": Self.hexString(fill)]
      if let stroke { out["stroke"] = Self.hexString(stroke) }
      return out
    }
  }

  static func generate(_ image: CGImage) -> IconTheme? {
    guard let space = image.colorSpace, space.model == .rgb else { return nil }
    let colors = opaquePixels(image, space: space)
    guard !colors.isEmpty else { return nil }
    let mean = colors.reduce(SIMD3<Double>(), +) / Double(colors.count)
    let spread = colors.reduce(0.0) { $0 + (($1 - mean) * ($1 - mean)).sum().squareRoot() } / Double(colors.count)
    if spread >= 0.055 { return .blur }
    guard let fill = CGColor(colorSpace: space, components: [mean.x, mean.y, mean.z, 1]) else { return nil }
    if luminance(fill) > 0.88 {
      return .template(fill: CGColor(gray: 0, alpha: 1), stroke: CGColor(gray: 1, alpha: 0.3))
    }
    return .template(fill: fill, stroke: nil)
  }

  private static func opaquePixels(_ image: CGImage, space: CGColorSpace) -> [SIMD3<Double>] {
    var width = Double(image.width), height = Double(image.height)
    let longest = max(width, height)
    if longest > 0, 32 / longest < 1 {
      width *= 32 / longest
      height *= 32 / longest
    }
    let w = Int(width), h = Int(height)
    guard w > 0, h > 0 else { return [] }
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(
        data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { return [] }
    var colors: [SIMD3<Double>] = []
    for i in stride(from: 0, to: bytes.count, by: 4) where Double(bytes[i + 3]) / 255 >= 0.975 {
      colors.append(SIMD3(Double(bytes[i]), Double(bytes[i + 1]), Double(bytes[i + 2])) / 255)
    }
    return colors
  }

  private static func luminance(_ color: CGColor) -> Double {
    let c = (color.components ?? []).map(Double.init)
    guard c.count >= 3 else { return 0 }
    let linear = c.prefix(3).map { $0 <= 0.03928 ? $0 / 12.92 : pow(($0 + 0.055) / 1.055, 2.4) }
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }

  private static func hexString(_ color: CGColor) -> String {
    let srgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil) ?? color
    let c = (srgb.components ?? [0, 0, 0, 1]).map { Int((min(max($0, 0), 1) * 255).rounded()) }
    let rgba = c.count >= 4 ? c : [c[0], c[0], c[0], c.count > 1 ? c[1] : 255]
    return String(format: "#%02X%02X%02X%02X", rgba[0], rgba[1], rgba[2], rgba[3])
  }
}
