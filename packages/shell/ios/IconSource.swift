import AppKit
import CoreImage
import ExpoModulesCore

struct IconSource: Equatable {
  let uri: String?
  let emoji: String?

  init?(uri: String?, emoji: String?) {
    guard uri?.isEmpty == false || emoji?.isEmpty == false else { return nil }
    self.uri = uri
    self.emoji = emoji
  }

  var key: String { emoji.map { "e:\($0)" } ?? "u:\(uri ?? "")" }

  func load() -> CGImage? {
    if let emoji, !emoji.isEmpty {
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
      guard let bitmap else { return nil }
      bitmap.size = NSSize(width: 16, height: 16)
      guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = context
      let text = NSAttributedString(string: emoji, attributes: [.font: NSFont.systemFont(ofSize: 16)])
      let size = text.size()
      text.draw(at: NSPoint(x: (16 - size.width) / 2, y: (16 - size.height) / 2))
      NSGraphicsContext.restoreGraphicsState()
      return bitmap.cgImage
    }
    guard let uri else { return nil }
    let image: NSImage?
    if uri.hasPrefix("data:") {
      let base64 = uri.split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
      image = Data(base64Encoded: base64).flatMap(NSImage.init(data:))
    } else if let url = URL(string: uri), url.isFileURL {
      image = NSImage(contentsOfFile: url.path)
    } else {
      image = nil
    }
    return image?.cgImage(forProposedRect: nil, context: nil, hints: nil)
  }
}
