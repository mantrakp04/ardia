import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let box: CGFloat = 16
let scale: CGFloat = 4
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
for name in CommandLine.arguments.dropFirst(2) {
  let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular).applying(.init(paletteColors: [NSColor(white: 1, alpha: 0.86)]))
  guard let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config) else {
    print("missing \(name)")
    continue
  }
  let pixels = Int(box * scale)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: box, height: box)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let size = symbol.size
  symbol.draw(in: NSRect(x: (box - size.width) / 2, y: (box - size.height) / 2, width: size.width, height: size.height))
  NSGraphicsContext.restoreGraphicsState()
  try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent("\(name).png"))
}
