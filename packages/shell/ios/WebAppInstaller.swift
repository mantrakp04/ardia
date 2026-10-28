import AppKit
import CryptoKit
import ImageIO
import UniformTypeIdentifiers

enum WebAppInstaller {
  static let iconSizes = [1024, 512, 256, 128, 64, 32, 16]

  static var folder: URL {
    if FileDropView.background { return URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ArdiaWebApps") }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Ardia Apps")
  }

  static func install(name: String, url: String, profile: String, icon: String?) throws -> String {
    guard let page = URL(string: url), ["http", "https"].contains(page.scheme?.lowercased() ?? "") else {
      throw CocoaError(.fileWriteInvalidFileName)
    }
    let identifier = "com.ardia.webapp." + SHA256.hash(data: Data("\(profile)\n\(url)".utf8)).prefix(6).map { String(format: "%02x", $0) }.joined()
    let files = FileManager.default
    try files.createDirectory(at: folder, withIntermediateDirectories: true)

    let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let file = title.replacingOccurrences(of: "[/:\\\\]", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: ". "))
    let bundle = folder.appendingPathComponent(".installing-\(UUID().uuidString).app")
    var moved = false
    defer { if !moved { try? files.removeItem(at: bundle) } }

    let contents = bundle.appendingPathComponent("Contents")
    try files.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
    try files.createDirectory(at: contents.appendingPathComponent("Resources"), withIntermediateDirectories: true)

    let launcher = contents.appendingPathComponent("MacOS/launcher")
    let host = Bundle.main.bundleIdentifier ?? "com.ardia.browser"
    try "#!/bin/bash\nexec /usr/bin/open -b '\(host)' '\(launchLink(url: url, profile: profile))'\n".write(to: launcher, atomically: true, encoding: .utf8)
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: launcher.path)

    let info: [String: Any] = [
      "CFBundleIdentifier": identifier,
      "CFBundleName": title,
      "CFBundleDisplayName": title,
      "CFBundleExecutable": "launcher",
      "CFBundleIconFile": "AppIcon",
      "CFBundlePackageType": "APPL",
      "CFBundleVersion": "1",
      "CFBundleShortVersionString": "1.0",
      "LSUIElement": true,
      "NSHighResolutionCapable": true,
      "ArdiaWebAppURL": url,
      "ArdiaWebAppProfile": profile,
    ]
    try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
    try writeIcon(icon: icon, title: title, to: contents.appendingPathComponent("Resources/AppIcon.icns"))

    var replaced: [(original: URL, backup: URL)] = []
    var installed = folder
    do {
      for old in (try? files.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] where old.pathExtension == "app" && old.lastPathComponent != bundle.lastPathComponent {
        let plist = NSDictionary(contentsOf: old.appendingPathComponent("Contents/Info.plist"))
        guard plist?["CFBundleIdentifier"] as? String == identifier else { continue }
        let backup = folder.appendingPathComponent(".replaced-\(UUID().uuidString).app")
        try files.moveItem(at: old, to: backup)
        replaced.append((old, backup))
      }
      installed = folder.appendingPathComponent("\(file.isEmpty ? "App" : String(file.prefix(60))).app")
      var copy = 2
      while files.fileExists(atPath: installed.path) {
        installed = folder.appendingPathComponent("\(file.isEmpty ? "App" : String(file.prefix(60))) \(copy).app")
        copy += 1
      }
      try files.moveItem(at: bundle, to: installed)
    } catch {
      for (original, backup) in replaced { try? files.moveItem(at: backup, to: original) }
      throw error
    }
    moved = true
    for (_, backup) in replaced { try? files.trashItem(at: backup, resultingItemURL: nil) }
    return installed.path
  }

  static func launchLink(url: String, profile: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    let encode = { (text: String) in text.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
    return "ardia-app://open?url=\(encode(url))&profile=\(encode(profile))"
  }

  static func writeIcon(icon: String?, title: String, to file: URL) throws {
    let favicon = icon.flatMap { $0.split(separator: ",", maxSplits: 1).last }.flatMap { Data(base64Encoded: String($0)) }.flatMap(NSImage.init(data:))
    guard let destination = CGImageDestinationCreateWithURL(file as CFURL, UTType.icns.identifier as CFString, iconSizes.count, nil) else {
      throw CocoaError(.fileWriteUnknown)
    }
    for pixels in iconSizes {
      guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: rep)
      else { throw CocoaError(.fileWriteUnknown) }
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = context
      context.imageInterpolation = .high
      draw(favicon: favicon, title: title, side: CGFloat(pixels))
      NSGraphicsContext.restoreGraphicsState()
      guard let image = rep.cgImage else { throw CocoaError(.fileWriteUnknown) }
      CGImageDestinationAddImage(destination, image, nil)
    }
    guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
  }

  static func draw(favicon: NSImage?, title: String, side: CGFloat) {
    let tile = NSRect(x: side * 0.098, y: side * 0.098, width: side * 0.804, height: side * 0.804)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.25)
    shadow.shadowBlurRadius = side * 0.02
    shadow.shadowOffset = NSSize(width: 0, height: -side * 0.01)
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor(white: favicon == nil ? 0.36 : 0.97, alpha: 1).setFill()
    NSBezierPath(roundedRect: tile, xRadius: side * 0.18, yRadius: side * 0.18).fill()
    NSGraphicsContext.restoreGraphicsState()
    if let favicon, favicon.size.width > 0, favicon.size.height > 0 {
      let box = side * 0.5
      let scale = min(box / favicon.size.width, box / favicon.size.height)
      let size = NSSize(width: favicon.size.width * scale, height: favicon.size.height * scale)
      favicon.draw(in: NSRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
    } else {
      let letter = NSAttributedString(
        string: title.first.map { String($0).uppercased() } ?? "A",
        attributes: [.font: NSFont.systemFont(ofSize: side * 0.46, weight: .semibold), .foregroundColor: NSColor.white])
      let size = letter.size()
      letter.draw(at: NSPoint(x: (side - size.width) / 2, y: (side - size.height) / 2))
    }
  }
}
