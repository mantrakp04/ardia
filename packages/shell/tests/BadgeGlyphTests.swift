import AppKit

func badge(_ text: String = "Q", size: CGFloat = 24, fontSize: Double = 12, color: NSColor = .white, initial: Bool = false) -> BadgeGlyphView {
  let view = BadgeGlyphView()
  view.text = text
  view.initial = initial
  view.fontSize = fontSize
  view.color = color
  view.frame = CGRect(x: 0, y: 0, width: size, height: size)
  return view
}

func badgeImage(_ view: BadgeGlyphView) -> NSImage {
  guard let image = (view.subviews.first as? NSImageView)?.image else { fatalError("Missing badge image") }
  return image
}

func imageData(_ image: NSImage) -> Data {
  guard let pixels = image.cgImage(forProposedRect: nil, context: nil, hints: nil)?.dataProvider?.data else {
    fatalError("Missing image pixels")
  }
  return pixels as Data
}

if CommandLine.arguments.contains("--benchmark") {
  var coldTimes: [Double] = []
  var warmTimes: [Double] = []
  for round in 0..<31 {
    let tint = NSColor(deviceRed: 0.5 + Double(round) / 100, green: 0.8, blue: 1, alpha: 1)
    let values = ["Q", "I", "T", "S", "W", ".", "😀", "🧑‍💻", "🇯🇵"]
    let coldStart = ProcessInfo.processInfo.systemUptime
    let cold = values.map { badge($0, color: tint) }
    let coldElapsed = ProcessInfo.processInfo.systemUptime - coldStart
    let warmStart = ProcessInfo.processInfo.systemUptime
    let warm = values.map { badge($0, color: tint) }
    let warmElapsed = ProcessInfo.processInfo.systemUptime - warmStart
    for (first, second) in zip(cold, warm) {
      guard badgeImage(first) === badgeImage(second) else { fatalError("Warm badge missed cache") }
    }
    if round > 0 {
      coldTimes.append(coldElapsed * 1000)
      warmTimes.append(warmElapsed * 1000)
    }
  }
  coldTimes.sort()
  warmTimes.sort()
  print("Nine badges,30 interleaved rounds: cold median \(coldTimes[15])ms,p95 \(coldTimes[28])ms,range \(coldTimes.first!)...\(coldTimes.last!)ms;warm median \(warmTimes[15])ms,p95 \(warmTimes[28])ms,range \(warmTimes.first!)...\(warmTimes.last!)ms")
  exit(0)
}

let firstBadge = badge()
let firstImage = badgeImage(firstBadge)
let equivalentBadge = badge("  Quinn", color: NSColor(deviceRed: 1, green: 1, blue: 1, alpha: 1), initial: true)
guard badgeImage(equivalentBadge) === firstImage else { fatalError("Equivalent badges did not share their image") }
firstBadge.setFrameSize(firstBadge.frame.size)
guard badgeImage(firstBadge) === firstImage else { fatalError("Unchanged size replaced the image") }
for different in [badge("W"), badge(size: 26), badge(fontSize: 13), badge(color: .red)] {
  let image = badgeImage(different)
  guard image !== firstImage, imageData(image) != imageData(firstImage) else {
    fatalError("Changed badge reused stale pixels")
  }
}
testBackingScale = 4
let sharperBadge = badge()
guard badgeImage(sharperBadge) !== firstImage else { fatalError("Backing scale reused stale image") }
firstBadge.viewDidChangeBackingProperties()
guard badgeImage(firstBadge) === badgeImage(sharperBadge) else { fatalError("Backing change missed shared image") }
testBackingScale = 2
let zeroBadge = BadgeGlyphView()
zeroBadge.text = "Q"
zeroBadge.fontSize = 12
guard (zeroBadge.subviews.first as! NSImageView).image == nil else { fatalError("Zero-size badge rasterized") }
zeroBadge.frame.size = CGSize(width: 24, height: 24)
guard badgeImage(zeroBadge) === firstImage else { fatalError("Resized badge missed shared image") }
print("Passed shared badge cache checks")

var checks = 0
var renderedInitials: [String: [UInt8]] = [:]
var maximumOffset: Double = 0
var maximumCase = ""
for rasterScale in [2, 4] {
  testBackingScale = CGFloat(rasterScale)
  for size in [16, 24, 26, 64] {
    for origin in [0.0, 0.25, 0.5, 0.75] {
      for ratio in [0.46, 0.55] {
        renderedInitials.removeAll(keepingCapacity: true)
        for value in ["?", "I", "T", "S", "W", ".", "😀", "🧑‍💻", "🇯🇵", "💼", "🎵", "👨‍👩‍👧‍👦", "E\u{301}", "ß", " ", "", "  E\u{301}lodie", "🧑‍💻Work"] {
          for flipped in [false, true] {
            let pixelSize = (size + 8) * rasterScale
            let context = CGContext(data: nil, width: pixelSize, height: pixelSize, bitsPerComponent: 8, bytesPerRow: pixelSize * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.scaleBy(x: CGFloat(rasterScale), y: CGFloat(rasterScale))
            let graphics = NSGraphicsContext(cgContext: context, flipped: flipped)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = graphics
            let parent = ExpoView()
            parent.frame = NSRect(x: 0, y: 0, width: size + 8, height: size + 8)
            let view = BadgeGlyphView()
            view.frame = NSRect(x: 4 + origin, y: 4 + origin, width: Double(size), height: Double(size))
            view.text = value
            view.initial = !value.contains("😀") && !value.contains("💼") && !value.contains("🎵") && !value.contains("🇯🇵")
            view.fontSize = Double(size) * ratio
            parent.addSubview(view)
            parent.displayIgnoringOpacity(parent.bounds, in: graphics)
            NSGraphicsContext.restoreGraphicsState()
            let buffer = context.data!.assumingMemoryBound(to: UInt8.self)
            let pixels = Array(UnsafeBufferPointer(start: buffer, count: pixelSize * pixelSize * 4))
            if view.initial {
              let expected = value.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?"
              let key = "\(rasterScale)-\(size)-\(origin)-\(ratio)-\(flipped)-\(expected)"
              if let previous = renderedInitials[key] {
                guard pixels == previous else { fatalError("Initial differs from first grapheme: \(value)") }
              }
              renderedInitials[key] = pixels
            }
            let plateSize = size * rasterScale
            let plate = CGContext(data: nil, width: plateSize, height: plateSize, bitsPerComponent: 8, bytesPerRow: plateSize * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            plate.setFillColor(NSColor.white.cgColor)
            plate.fillEllipse(in: CGRect(x: 0, y: 0, width: plateSize, height: plateSize))
            (view.subviews.first as! NSImageView).image = NSImage(cgImage: plate.makeImage()!, size: view.bounds.size)
            context.clear(CGRect(x: 0, y: 0, width: size + 8, height: size + 8))
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = graphics
            parent.displayIgnoringOpacity(parent.bounds, in: graphics)
            NSGraphicsContext.restoreGraphicsState()
            var plateMinX = pixelSize, plateMinY = pixelSize, plateMaxX = -1, plateMaxY = -1
            for y in 0..<pixelSize {
              for x in 0..<pixelSize where buffer[(y * pixelSize + x) * 4 + 3] > 127 {
                plateMinX = min(plateMinX, x)
                plateMaxX = max(plateMaxX, x)
                plateMinY = min(plateMinY, y)
                plateMaxY = max(plateMaxY, y)
              }
            }
            let expectedX = Double(plateMinX + plateMaxX + 1) / 2
            let expectedY = Double(plateMinY + plateMaxY + 1) / 2
            for threshold in [0, 32, 127] {
              var minX = pixelSize, minY = pixelSize, maxX = -1, maxY = -1
              for y in 0..<pixelSize {
                for x in 0..<pixelSize where pixels[(y * pixelSize + x) * 4 + 3] > threshold {
                  minX = min(minX, x)
                  maxX = max(maxX, x)
                  minY = min(minY, y)
                  maxY = max(maxY, y)
                }
              }
              guard maxX >= 0 else { fatalError("No glyph rendered: \(value)") }
              let offsetX = abs(Double(minX + maxX + 1) / 2 - expectedX)
              let offsetY = abs(Double(minY + maxY + 1) / 2 - expectedY)
              let offset = max(offsetX, offsetY)
              if offset > maximumOffset {
                maximumOffset = offset
                maximumCase = "\(value),size\(size),scale\(rasterScale),origin\(origin),ratio\(ratio),flipped\(flipped),alpha\(threshold),xy\(offsetX)/\(offsetY)"
              }
              guard offset <= 0.5 else { fatalError("Not centered: \(maximumCase)") }
              checks += 1
            }
          }
        }
      }
    }
  }
}
print("Passed \(checks) glyph rendering checks; maximum physical pixel offset \(maximumOffset): \(maximumCase)")
