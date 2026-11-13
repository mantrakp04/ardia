#if canImport(UIKit)
import Foundation
import UIKit
import WebKit

public struct ToneColor: Hashable, Sendable {
  public let red: Double
  public let green: Double
  public let blue: Double

  public init(red: Double, green: Double, blue: Double) {
    self.red = (red * 255).rounded() / 255
    self.green = (green * 255).rounded() / 255
    self.blue = (blue * 255).rounded() / 255
  }

  public init?(_ color: UIColor?) {
    guard let color else { return nil }
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha), alpha > 0.5 else { return nil }
    self.init(red: min(max(red, 0), 1), green: min(max(green, 0), 1), blue: min(max(blue, 0), 1))
  }

  public init?(hex: String?) {
    guard var text = hex?.trimmingCharacters(in: .whitespaces) else { return nil }
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
    self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
  }

  public var hex: String {
    let channel = { (value: Double) in Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", channel(red), channel(green), channel(blue))
  }

  public var luminance: Double {
    func linear(_ channel: Double) -> Double {
      channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }

  public var isDark: Bool { luminance < 0.18 }
}

public struct PageTone: Equatable, Sendable {
  public var top: ToneColor?
  public var bottom: ToneColor?

  public init(top: ToneColor? = nil, bottom: ToneColor? = nil) {
    self.top = top
    self.bottom = bottom
  }

  public static func resolve(theme: UIColor?, underPage: UIColor?, sampled: PageTone?, stored: String?) -> PageTone {
    let stored = ToneColor(hex: stored)
    let theme = ToneColor(theme)
    let underPage = ToneColor(underPage)
    return PageTone(
      top: theme ?? sampled?.top ?? underPage ?? stored,
      bottom: sampled?.bottom ?? underPage ?? theme ?? stored
    )
  }
}

public enum ToneSampler {
  public static let sampleWidth = 32
  public static let bandHeight: CGFloat = 4

  @MainActor
  public static func sample(_ webView: WKWebView, topInset: CGFloat, bottomInset: CGFloat) async -> PageTone? {
    let bounds = webView.bounds
    let top = webView.safeAreaInsets.top + topInset + 1
    let bottom = bounds.height - bottomInset - bandHeight - 2
    guard bottom > top else { return nil }
    async let topImage = snapshot(of: webView, in: CGRect(x: 0, y: top, width: bounds.width, height: bandHeight))
    async let bottomImage = snapshot(of: webView, in: CGRect(x: 0, y: bottom, width: bounds.width, height: bandHeight))
    let images = await (topImage, bottomImage)
    let tone = PageTone(top: images.0.flatMap(dominant), bottom: images.1.flatMap(dominant))
    return tone.top == nil && tone.bottom == nil ? nil : tone
  }

  @MainActor
  private static func snapshot(of webView: WKWebView, in rect: CGRect) async -> UIImage? {
    let configuration = WKSnapshotConfiguration()
    configuration.rect = rect
    configuration.afterScreenUpdates = false
    configuration.snapshotWidth = NSNumber(value: sampleWidth)
    return try? await webView.takeSnapshot(configuration: configuration)
  }

  public static func dominant(in image: UIImage) -> ToneColor? {
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
#endif
