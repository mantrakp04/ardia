import AppKit

enum CaptureClipboard {
  private static let keptFor: TimeInterval = 60
  private static let mostKept = 6
  private static var kept: [(id: Int, png: Data)] = []
  private static var lastKept = 0

  static func keep(_ png: Data) -> Int {
    lastKept += 1
    let id = lastKept
    kept.append((id, png))
    if kept.count > mostKept { kept.removeFirst(kept.count - mostKept) }
    DispatchQueue.main.asyncAfter(deadline: .now() + keptFor) {
      kept.removeAll { $0.id == id }
    }
    return id
  }

  static func save(_ id: Int, folder: String, name: String) -> String? {
    guard let png = kept.first(where: { $0.id == id })?.png, !folder.isEmpty else { return nil }
    let directory = URL(fileURLWithPath: (folder as NSString).expandingTildeInPath, isDirectory: true)
    let base = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: ".")
    var file = directory.appendingPathComponent(base).appendingPathExtension("png")
    var copy = 2
    while FileManager.default.fileExists(atPath: file.path) {
      file = directory.appendingPathComponent("\(base) \(copy)").appendingPathExtension("png")
      copy += 1
    }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try png.write(to: file, options: .withoutOverwriting)
    } catch {
      return nil
    }
    return file.path
  }

  static func copy(_ image: CGImage, points: NSSize) -> Data? {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let srgb = context.makeImage() else { return nil }
    let bitmap = NSBitmapImageRep(cgImage: srgb)
    bitmap.size = points
    guard let png = bitmap.representation(using: .png, properties: [:]), let tiff = bitmap.tiffRepresentation else { return nil }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setData(png, forType: .png)
    pasteboard.setData(tiff, forType: .tiff)
    return png
  }
}
