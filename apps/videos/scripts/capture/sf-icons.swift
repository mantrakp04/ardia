import AppKit

let dir = CommandLine.arguments[1]
NSApplication.shared.setActivationPolicy(.prohibited)
try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

func write(_ image: NSImage, _ px: NSSize, _ name: String) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(px.width), pixelsHigh: Int(px.height), bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  image.draw(in: NSRect(origin: .zero, size: px))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
}

var sizes: [String] = []
for arg in CommandLine.arguments.dropFirst(2) {
  if arg.hasPrefix("app:") {
    let parts = arg.dropFirst(4).split(separator: "=", maxSplits: 1).map(String.init)
    let icon = NSWorkspace.shared.icon(forFile: parts[1])
    write(icon, NSSize(width: 256, height: 256), "app-\(parts[0])")
  } else if arg.hasPrefix("folder:") {
    let icon = NSWorkspace.shared.icon(for: .folder)
    write(icon, NSSize(width: 256, height: 256), "folder-\(arg.dropFirst(7))")
  } else {
    let config = NSImage.SymbolConfiguration(pointSize: 64, weight: .regular)
    guard let symbol = NSImage(systemSymbolName: arg, accessibilityDescription: nil)?.withSymbolConfiguration(config) else {
      FileHandle.standardError.write("no symbol \(arg)\n".data(using: .utf8)!)
      continue
    }
    let tinted = NSImage(size: symbol.size, flipped: false) { rect in
      symbol.draw(in: rect)
      NSColor.black.set()
      rect.fill(using: .sourceAtop)
      return true
    }
    let px = NSSize(width: (symbol.size.width * 2).rounded(), height: (symbol.size.height * 2).rounded())
    write(tinted, px, "sym-\(arg)")
    sizes.append("\"\(arg)\": [\(symbol.size.width), \(symbol.size.height)]")
  }
}
print("{\(sizes.joined(separator: ", "))}")
