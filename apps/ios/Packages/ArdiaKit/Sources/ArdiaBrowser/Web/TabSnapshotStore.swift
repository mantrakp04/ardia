import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

@MainActor
public final class TabSnapshotStore {
  nonisolated public static let pointWidth = 390.0
  nonisolated static let pixelWidth = 600

  public let directory: URL
  private let cache = NSCache<NSString, CGImage>()

  public init(directory: URL = URL.cachesDirectory.appending(path: "TabSnapshots", directoryHint: .isDirectory)) {
    self.directory = directory
    cache.countLimit = 40
  }

  public func fileName(for tabID: UUID) -> String { "\(tabID.uuidString).jpg" }

  public func save(_ image: CGImage, scale: CGFloat, for tabID: UUID) async -> String? {
    let name = fileName(for: tabID)
    let url = directory.appending(path: name)
    let directory = directory
    guard let written = await Self.encode(image, to: url, in: directory) else { return nil }
    cache.setObject(written, forKey: name as NSString)
    return name
  }

  public func keepInMemory(_ image: CGImage, for tabID: UUID) -> String {
    let name = "memory-\(tabID.uuidString)"
    cache.setObject(Self.downscale(image, toWidth: Self.pixelWidth) ?? image, forKey: name as NSString)
    return name
  }

  public func image(named name: String) async -> CGImage? {
    if let cached = cache.object(forKey: name as NSString) { return cached }
    guard !name.hasPrefix("memory-") else { return nil }
    guard let image = await Self.decode(directory.appending(path: name)) else { return nil }
    cache.setObject(image, forKey: name as NSString)
    return image
  }

  public func remove(_ names: [String]) {
    for name in names {
      cache.removeObject(forKey: name as NSString)
      try? FileManager.default.removeItem(at: directory.appending(path: name))
    }
  }

  @concurrent
  static func encode(_ image: CGImage, to url: URL, in directory: URL) async -> CGImage? {
    let scaled = downscale(image, toWidth: pixelWidth) ?? image
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let temporary = directory.appending(path: ".\(UUID().uuidString).jpg")
    guard let destination = CGImageDestinationCreateWithURL(temporary as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, scaled, [kCGImageDestinationLossyCompressionQuality: 0.72] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      try? FileManager.default.removeItem(at: temporary)
      return nil
    }
    do {
      _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
    } catch {
      try? FileManager.default.removeItem(at: temporary)
      return nil
    }
    return scaled
  }

  @concurrent
  static func decode(_ url: URL) async -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
  }

  nonisolated static func downscale(_ image: CGImage, toWidth width: Int) -> CGImage? {
    guard image.width > width else { return image }
    let height = Int((Double(image.height) * Double(width) / Double(image.width)).rounded())
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
  }
}
