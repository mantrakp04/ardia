import Foundation

enum GlyphInk {
  static let inkThreshold: UInt8 = 16

  static func offset(alpha: [UInt8], width: Int, height: Int, scale: Double) -> (dx: Double, dy: Double) {
    guard width > 0, height > 0, scale > 0, alpha.count >= width * height else { return (0, 0) }
    var left = width
    var right = -1
    var top = height
    var bottom = -1
    for y in 0..<height {
      for x in 0..<width where alpha[y * width + x] >= inkThreshold {
        left = min(left, x)
        right = max(right, x)
        top = min(top, y)
        bottom = max(bottom, y)
      }
    }
    guard right >= 0 else { return (0, 0) }
    let inkCenterX = Double(left + right + 1) / 2
    let inkCenterY = Double(top + bottom + 1) / 2
    return ((Double(width) / 2 - inkCenterX) / scale, (Double(height) / 2 - inkCenterY) / scale)
  }
}
