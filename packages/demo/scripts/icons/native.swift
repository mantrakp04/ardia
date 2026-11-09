import AppKit
let args = CommandLine.arguments
let jobs = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[1]))) as! [[String: Any]]
let outDir = args[2]
let scale = 2
let weights: [String: NSFont.Weight] = ["light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold]
var metrics: [[String: Any]] = []
for job in jobs {
  let name = job["name"] as! String
  let weight = job["weight"] as! String
  let pt = job["pt"] as! Double
  let box = job["box"] as! Double
  let file = job["file"] as! String
  let view = NSImageView(frame: NSRect(x: 0, y: 0, width: box, height: box))
  view.imageScaling = .scaleNone
  view.contentTintColor = .black
  guard let img = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: pt, weight: weights[weight]!)) else {
    metrics.append(["file": file, "missing": true]); continue
  }
  view.image = img
  let px = Int(box) * scale
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: box, height: box)
  view.cacheDisplay(in: view.bounds, to: rep)
  let gray = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 1, hasAlpha: false, isPlanar: false, colorSpaceName: .deviceWhite, bytesPerRow: px, bitsPerPixel: 8)!
  let src = rep.bitmapData!, dst = gray.bitmapData!
  let bpr = rep.bytesPerRow
  for y in 0..<px { for x in 0..<px { dst[y * px + x] = src[y * bpr + x * 4 + 3] } }
  try! gray.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: outDir + "/" + file))
  metrics.append(["file": file, "w": img.size.width, "h": img.size.height, "al": [img.alignmentRect.origin.x, img.alignmentRect.origin.y, img.alignmentRect.width, img.alignmentRect.height]])
}
try! JSONSerialization.data(withJSONObject: metrics, options: [.prettyPrinted]).write(to: URL(fileURLWithPath: outDir + "/metrics.json"))
