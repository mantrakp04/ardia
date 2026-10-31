import AppKit
import ImageIO

enum MenuFavicon {
  static let maxBytes = 65_536

  static func prepare(_ sources: [String]) -> [String: CGImage] {
    var images: [String: CGImage] = [:]
    var budget = 16
    var attempted = Set<String>()
    for source in sources {
      guard source.utf8.count <= maxBytes * 2,
            let url = URL(string: source), url.isFileURL || url.scheme == "data",
            attempted.insert(source).inserted else { continue }
      guard budget > 0 else { break }
      budget -= 1
      if let image = thumbnail(url) { images[source] = image }
    }
    return images
  }

  static func apply(to entry: NSMenuItem, favicon: String?, symbol: String?, images: [String: CGImage]) {
    entry.image = favicon.flatMap { images[$0] }.map { NSImage(cgImage: $0, size: NSSize(width: 16, height: 16)) }
      ?? symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }
  }

  static func thumbnail(_ url: URL) -> CGImage? {
    let data: Data
    if url.isFileURL {
      guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
            values.isRegularFile == true, let size = values.fileSize, size <= maxBytes,
            let file = try? FileHandle(forReadingFrom: url) else { return nil }
      defer { try? file.close() }
      guard let bytes = try? file.read(upToCount: maxBytes + 1), bytes.count <= maxBytes else { return nil }
      data = bytes
    } else {
      guard let bytes = try? Data(contentsOf: url), bytes.count <= maxBytes else { return nil }
      data = bytes
    }
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 1024, height <= 1024 else { return nil }
    return CGImageSourceCreateThumbnailAtIndex(source, 0, [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceThumbnailMaxPixelSize: 32,
      kCGImageSourceShouldCacheImmediately: true,
    ] as CFDictionary)
  }
}
