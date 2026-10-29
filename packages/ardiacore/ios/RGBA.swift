import AppKit

public struct RGBA {
  public let red, green, blue, alpha: Double

  public init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
    let rgba = s.count == 6 ? (v << 8) | 0xFF : v
    red = Double((rgba >> 24) & 0xFF) / 255
    green = Double((rgba >> 16) & 0xFF) / 255
    blue = Double((rgba >> 8) & 0xFF) / 255
    alpha = Double(rgba & 0xFF) / 255
  }

  public var srgb: NSColor { NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha) }

  public var displayP3: NSColor { NSColor(displayP3Red: red, green: green, blue: blue, alpha: alpha) }

  public var simd: SIMD4<Float> { SIMD4(Float(red), Float(green), Float(blue), Float(alpha)) }
}
