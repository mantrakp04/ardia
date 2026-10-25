import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum DemoArtwork {
  enum Scene: String, CaseIterable {
    case sunset
    case night
    case boulders
  }

  static func url(for scene: Scene) -> URL? {
    let directory = URL.cachesDirectory.appending(path: "ArdiaDemoArtwork", directoryHint: .isDirectory)
    let file = directory.appending(path: "\(scene.rawValue)-v1.jpg")
    if FileManager.default.fileExists(atPath: file.path()) { return file }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    guard let image = render(scene), write(image, to: file) else { return nil }
    return file
  }

  private static func render(_ scene: Scene) -> CGImage? {
    let width = 900
    let height = 780
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let size = CGSize(width: width, height: height)
    var random = SeededRandom(seed: UInt64(scene.rawValue.utf8.reduce(7) { $0 &* 31 &+ UInt64($1) }))
    switch scene {
    case .sunset:
      sky(context, size, [0x2B1B5E, 0x8C3B7E, 0xF07A5A, 0xFFC27A])
      sun(context, CGPoint(x: size.width * 0.62, y: size.height * 0.42), 70, 0xFFE3A3)
      ridge(context, size, base: 0.42, amplitude: 0.06, color: 0x6A3A72, random: &random)
      ridge(context, size, base: 0.3, amplitude: 0.05, color: 0x46265A, random: &random)
      ridge(context, size, base: 0.16, amplitude: 0.04, color: 0x26173A, random: &random)
      joshuaTrees(context, size, count: 4, color: 0x150C22, random: &random)
    case .night:
      sky(context, size, [0x05071C, 0x0E1640, 0x27306E, 0x4A3E86])
      stars(context, size, count: 260, random: &random)
      ridge(context, size, base: 0.26, amplitude: 0.07, color: 0x141235, random: &random)
      ridge(context, size, base: 0.14, amplitude: 0.04, color: 0x0A0A1E, random: &random)
      joshuaTrees(context, size, count: 2, color: 0x05050F, random: &random)
    case .boulders:
      sky(context, size, [0xF6D7B0, 0xBFD9EE, 0x7FB2E0, 0x5C93D1])
      boulders(context, size, random: &random)
    }
    return context.makeImage()
  }

  private static func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(
      srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
  }

  private static func sky(_ context: CGContext, _ size: CGSize, _ stops: [UInt32]) {
    let colors = stops.map { color($0) } as CFArray
    let locations: [CGFloat] = stops.indices.map { CGFloat($0) / CGFloat(stops.count - 1) }
    guard let gradient = CGGradient(colorsSpace: nil, colors: colors, locations: locations) else { return }
    context.drawLinearGradient(
      gradient, start: CGPoint(x: 0, y: size.height), end: CGPoint(x: size.width * 0.2, y: 0), options: [])
  }

  private static func sun(_ context: CGContext, _ center: CGPoint, _ radius: CGFloat, _ hex: UInt32) {
    for ring in stride(from: 4, through: 1, by: -1) {
      let r = radius * (1 + CGFloat(ring) * 0.45)
      context.setFillColor(color(hex, alpha: 0.08))
      context.fillEllipse(in: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
    }
    context.setFillColor(color(hex))
    context.fillEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
  }

  private static func ridge(
    _ context: CGContext, _ size: CGSize, base: CGFloat, amplitude: CGFloat, color hex: UInt32,
    random: inout SeededRandom
  ) {
    let phase = random.next() * 6
    let frequency = 1.5 + random.next() * 2
    let path = CGMutablePath()
    path.move(to: .zero)
    for step in 0...90 {
      let x = CGFloat(step) / 90
      let wave = sin(x * frequency * .pi + phase) * 0.6 + sin(x * frequency * 2.7 * .pi + phase * 1.7) * 0.4
      path.addLine(to: CGPoint(x: x * size.width, y: (base + amplitude * wave) * size.height))
    }
    path.addLine(to: CGPoint(x: size.width, y: 0))
    path.closeSubpath()
    context.setFillColor(color(hex))
    context.addPath(path)
    context.fillPath()
  }

  private static func joshuaTrees(
    _ context: CGContext, _ size: CGSize, count: Int, color hex: UInt32, random: inout SeededRandom
  ) {
    context.setStrokeColor(color(hex))
    context.setLineCap(.round)
    for index in 0..<count {
      let x = size.width * (0.12 + CGFloat(index) / CGFloat(max(count, 1)) * 0.8 + random.next() * 0.05)
      let ground = size.height * (0.1 + random.next() * 0.04)
      let height = size.height * (0.16 + random.next() * 0.1)
      context.setLineWidth(size.width * 0.012)
      context.move(to: CGPoint(x: x, y: ground))
      context.addLine(to: CGPoint(x: x, y: ground + height))
      context.strokePath()
      context.setLineWidth(size.width * 0.008)
      for arm in 0..<3 {
        let start = CGPoint(x: x, y: ground + height * (0.55 + CGFloat(arm) * 0.15))
        let direction: CGFloat = arm.isMultiple(of: 2) ? -1 : 1
        let end = CGPoint(x: x + direction * height * 0.28, y: start.y + height * 0.22)
        context.move(to: start)
        context.addQuadCurve(to: end, control: CGPoint(x: end.x, y: start.y))
        context.strokePath()
        context.setFillColor(color(hex))
        context.fillEllipse(in: CGRect(x: end.x - height * 0.05, y: end.y - height * 0.02, width: height * 0.1, height: height * 0.12))
      }
    }
  }

  private static func stars(_ context: CGContext, _ size: CGSize, count: Int, random: inout SeededRandom) {
    for _ in 0..<count {
      let x = random.next() * size.width
      let y = size.height * (0.25 + random.next() * 0.75)
      let r = 0.6 + random.next() * random.next() * 2.4
      context.setFillColor(color(0xFFFFFF, alpha: 0.35 + random.next() * 0.65))
      context.fillEllipse(in: CGRect(x: x, y: y, width: r * 2, height: r * 2))
    }
    context.setFillColor(color(0xB9A8FF, alpha: 0.12))
    context.fillEllipse(in: CGRect(x: -size.width * 0.2, y: size.height * 0.45, width: size.width * 1.4, height: size.height * 0.25))
  }

  private static func boulders(_ context: CGContext, _ size: CGSize, random: inout SeededRandom) {
    context.setFillColor(color(0xD8B48A))
    context.fill(CGRect(x: 0, y: 0, width: size.width, height: size.height * 0.22))
    let tones: [UInt32] = [0xB98A5E, 0xA67650, 0xC99D70, 0x8F6242]
    for index in 0..<9 {
      let w = size.width * (0.18 + random.next() * 0.22)
      let h = w * (0.55 + random.next() * 0.35)
      let x = size.width * (random.next() * 0.9) - w * 0.2
      let y = size.height * (0.12 + random.next() * 0.16) + CGFloat(index % 3) * h * 0.25
      context.setFillColor(color(tones[index % tones.count]))
      context.fillEllipse(in: CGRect(x: x, y: y, width: w, height: h))
      context.setFillColor(color(0xFFFFFF, alpha: 0.12))
      context.fillEllipse(in: CGRect(x: x + w * 0.2, y: y + h * 0.55, width: w * 0.45, height: h * 0.3))
    }
  }

  private static func write(_ image: CGImage, to url: URL) -> Bool {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { return false }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
    return CGImageDestinationFinalize(destination)
  }
}

struct SeededRandom {
  private var state: UInt64

  init(seed: UInt64) {
    state = seed == 0 ? 0x9E37_79B9_7F4A_7C15 : seed
  }

  mutating func next() -> CGFloat {
    state ^= state << 13
    state ^= state >> 7
    state ^= state << 17
    return CGFloat(state % 10_000) / 10_000
  }
}
