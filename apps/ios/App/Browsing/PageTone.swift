import ArdiaBrowser
import SwiftUI
import UIKit

struct ToneColor: Hashable {
  let red: Double
  let green: Double
  let blue: Double

  init(red: Double, green: Double, blue: Double) {
    self.red = (red * 255).rounded() / 255
    self.green = (green * 255).rounded() / 255
    self.blue = (blue * 255).rounded() / 255
  }

  init?(_ color: UIColor?) {
    guard let color else { return nil }
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha), alpha > 0.5 else { return nil }
    self.init(red: min(max(red, 0), 1), green: min(max(green, 0), 1), blue: min(max(blue, 0), 1))
  }

  init?(hex: String?) {
    guard var text = hex?.trimmingCharacters(in: .whitespaces) else { return nil }
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
    self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
  }

  var color: Color { Color(.sRGB, red: red, green: green, blue: blue) }

  var luminance: Double {
    func linear(_ channel: Double) -> Double {
      channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }

  var isDark: Bool { luminance < 0.18 }

  var scheme: ColorScheme { isDark ? .dark : .light }
}

struct PageTone: Equatable {
  var top: ToneColor?
  var bottom: ToneColor?
}

enum ToneSampler {
  static let sampleWidth = 32
  static let bandHeight: CGFloat = 4

  static func dominant(in image: UIImage) -> ToneColor? {
    guard let cgImage = image.cgImage else { return nil }
    let width = sampleWidth
    let height = 2
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      ) else { return false }
      context.interpolationQuality = .low
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { return nil }
    var buckets: [Int: (count: Int, red: Int, green: Int, blue: Int)] = [:]
    for index in stride(from: 0, to: pixels.count, by: 4) {
      let red = Int(pixels[index]), green = Int(pixels[index + 1]), blue = Int(pixels[index + 2])
      let key = (red >> 4) << 8 | (green >> 4) << 4 | (blue >> 4)
      let bucket = buckets[key] ?? (0, 0, 0, 0)
      buckets[key] = (bucket.count + 1, bucket.red + red, bucket.green + green, bucket.blue + blue)
    }
    guard let best = buckets.values.max(by: { $0.count < $1.count }), best.count * 3 >= width * height else { return nil }
    let count = Double(best.count) * 255
    return ToneColor(red: Double(best.red) / count, green: Double(best.green) / count, blue: Double(best.blue) / count)
  }
}

extension BrowseSession {
  func tone(for tab: BrowserTab, page: WebTab?) -> PageTone {
    let sampled = tones[tab.id]
    let stored = ToneColor(hex: tab.themeColorHex)
    let theme = ToneColor(page?.themeColor)
    let underPage = ToneColor(page?.underPageBackgroundColor)
    return PageTone(
      top: theme ?? sampled?.top ?? underPage ?? stored,
      bottom: sampled?.bottom ?? underPage ?? theme ?? stored
    )
  }
}
