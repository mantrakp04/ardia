import AppKit

enum IconAccent {
  private static let hueBins = 24
  private static let minSaturation = 0.28
  private static let minBrightness = 0.22
  private static let minChromaticShare = 0.08

  static func dominant(_ image: CGImage) -> String? {
    let pixels = srgbPixels(image)
    guard !pixels.isEmpty else { return nil }
    var bins = [(weight: Double, sum: SIMD3<Double>, count: Int)](repeating: (0, SIMD3(), 0), count: hueBins)
    var chromatic = 0
    for rgb in pixels {
      let (hue, saturation, brightness) = hsv(rgb)
      guard saturation >= minSaturation, brightness >= minBrightness else { continue }
      chromatic += 1
      let bin = min(hueBins - 1, Int(hue * Double(hueBins)))
      bins[bin].weight += saturation * brightness
      bins[bin].sum += rgb
      bins[bin].count += 1
    }
    guard Double(chromatic) / Double(pixels.count) >= minChromaticShare else { return nil }
    let neighbours = { (i: Int) in (-1...1).map { bins[(i + $0 + hueBins) % hueBins] } }
    let windowWeight = { (i: Int) in neighbours(i).reduce(0.0) { $0 + $1.weight } }
    guard let peak = (0..<hueBins).max(by: { windowWeight($0) < windowWeight($1) }) else { return nil }
    let window = neighbours(peak)
    let count = window.reduce(0) { $0 + $1.count }
    guard count > 0 else { return nil }
    let mean = window.reduce(SIMD3<Double>()) { $0 + $1.sum } / Double(count)
    let c = [mean.x, mean.y, mean.z].map { Int((min(max($0, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", c[0], c[1], c[2])
  }

  private static func hsv(_ rgb: SIMD3<Double>) -> (Double, Double, Double) {
    let high = max(rgb.x, rgb.y, rgb.z), low = min(rgb.x, rgb.y, rgb.z), delta = high - low
    guard high > 0, delta > 0 else { return (0, 0, high) }
    var hue: Double
    if high == rgb.x {
      hue = (rgb.y - rgb.z) / delta
    } else if high == rgb.y {
      hue = (rgb.z - rgb.x) / delta + 2
    } else {
      hue = (rgb.x - rgb.y) / delta + 4
    }
    hue /= 6
    if hue < 0 { hue += 1 }
    return (hue, delta / high, high)
  }

  private static func srgbPixels(_ image: CGImage) -> [SIMD3<Double>] {
    let longest = Double(max(image.width, image.height))
    guard longest > 0 else { return [] }
    let scale = min(1, 32 / longest)
    let w = max(1, Int(Double(image.width) * scale)), h = max(1, Int(Double(image.height) * scale))
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return [] }
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
    var pixels: [SIMD3<Double>] = []
    for i in stride(from: 0, to: bytes.count, by: 4) {
      let alpha = Double(bytes[i + 3]) / 255
      guard alpha >= 0.5 else { continue }
      pixels.append(SIMD3(Double(bytes[i]), Double(bytes[i + 1]), Double(bytes[i + 2])) / 255 / alpha)
    }
    return pixels
  }
}
