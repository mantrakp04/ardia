import ArdiaSync
import Foundation

struct ShownTheme: Equatable, Hashable, Sendable {
  let look: SyncedTheme.Look
  let requestedDark: Bool
  let dark: Bool
}

extension SyncedTheme {
  var lightLook: Look? { light ?? Look(gradient: colors) }
  var darkLook: Look? { light == nil ? darkColors.flatMap(Look.init(gradient:)) : dark }

  func requestedDark(appDark: Bool, followsAppearance: Bool) -> Bool {
    switch (followsAppearance, mode ?? .auto) {
    case (true, _), (false, .auto): appDark
    case (false, .light): false
    case (false, .dark): true
    }
  }

  func resolved(dark: Bool) -> Look? {
    dark ? darkLook ?? lightLook : lightLook
  }

  func shown(appDark: Bool, followsAppearance: Bool = true) -> ShownTheme? {
    let requested = requestedDark(appDark: appDark, followsAppearance: followsAppearance)
    guard let resolved = resolved(dark: requested) else { return nil }
    let lightOnly = mode != .dark && darkLook == nil
    let look = followsAppearance && requested && lightOnly && !resolved.readableDark(true) ? resolved.darkened : resolved
    return ShownTheme(look: look, requestedDark: requested, dark: look.readableDark(requested))
  }
}

extension SyncedTheme.Stop {
  init?(hexString: String) {
    var text = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6 || text.count == 8, let value = UInt32(text, radix: 16) else { return nil }
    let rgb = text.count == 8 ? value >> 8 : value
    let alpha = text.count == 8 ? Double(value & 0xFF) / 255 : 1
    self.init(red: Double(rgb >> 16 & 0xFF) / 255, green: Double(rgb >> 8 & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255, alpha: alpha)
  }

  var rgb: LookRGB { LookRGB(red: red, green: green, blue: blue) }
}

extension SyncedTheme.Look {
  static let maxStops = 3
  static let reach = 0.75
  static let darkenedKeep = 0.4
  static let samplePoints: [Double] = [0, 0.5, 1]
  static let minBlackTextContrast = 3.0
  static let minWhiteTextContrast = 2.0

  init?(gradient colors: [String]) {
    let stops = colors.compactMap(SyncedTheme.Stop.init(hexString:)).prefix(Self.maxStops)
    guard !stops.isEmpty else { return nil }
    self.init(stops: Array(stops), intensity: 1, translucency: 0)
  }

  static func textureStrength(_ texture: SyncedTheme.Texture) -> Double {
    switch texture {
    case .grain: 0.8
    case .sand: 0.15
    case .denim: 0.6
    case .tweed: 0.4
    }
  }

  var arcAlpha: Double { 0.2 + 0.55 * clamp01(intensity) }
  var layerAlpha: Double { 1 - clamp01(translucency) * (1 - arcAlpha) }
  var grainAlpha: Double { clamp01(grain) * Self.textureStrength(texture) }

  func underlayAlpha(dark: Bool) -> Double {
    let arc = min(arcAlpha, 0.5)
    return clamp01(translucency) * (dark ? 0.35 * arc : arc)
  }

  func under(dark: Bool) -> LookRGB {
    let underlay = underlayAlpha(dark: dark)
    let blur = dark ? 0.16 : 0.92
    let grey = (dark ? 0 : 1) * underlay + blur * (1 - underlay)
    return LookRGB(red: grey, green: grey, blue: grey)
  }

  var darkened: SyncedTheme.Look {
    var look = self
    look.stops = stops.map { stop in
      var dimmed = stop
      dimmed.red *= Self.darkenedKeep
      dimmed.green *= Self.darkenedKeep
      dimmed.blue *= Self.darkenedKeep
      return dimmed
    }
    return look
  }

  func area(x: Double, y: Double, width: Double, height: Double) -> LookRGB {
    let first = stops[0]
    let second = stops.count > 1 ? stops[1] : first
    let base = Oklab.mix(first.rgb, second.rgb, clamp01(ThemeAxis.along(angle, x, y, width, height, half: ThemeAxis.baseHalf) / Self.reach))
    guard stops.count > 2 else { return base }
    let overlay = stops[2]
    let share = clamp01(ThemeAxis.along(angle + 45, x, y, width, height, half: ThemeAxis.overlayHalf)) * overlay.alpha
    return base.mixed(with: overlay.rgb, by: share)
  }

  func composite(dark: Bool, x: Double, y: Double) -> LookRGB {
    let alpha = layerAlpha
    let grey = under(dark: dark).red
    let color = area(x: x, y: y, width: 1, height: 1)
    func over(_ value: Double) -> Double { alpha * clamp01(value) + (1 - alpha) * grey }
    return LookRGB(red: over(color.red), green: over(color.green), blue: over(color.blue))
  }

  func opaqueTint(dark: Bool) -> [LookRGB] {
    [composite(dark: dark, x: 0, y: 0), composite(dark: dark, x: 1, y: 1)]
  }

  var accent: LookRGB { area(x: 0.5, y: 0.5, width: 1, height: 1) }

  func luminance(dark: Bool) -> Double {
    var sum = 0.0
    for x in Self.samplePoints {
      for y in Self.samplePoints { sum += composite(dark: dark, x: x, y: y).relativeLuminance }
    }
    return sum / Double(Self.samplePoints.count * Self.samplePoints.count)
  }

  func readableDark(_ dark: Bool) -> Bool {
    let lum = luminance(dark: dark)
    let blackText = (lum + 0.05) / 0.05
    let whiteText = 1.05 / (lum + 0.05)
    if dark { return !(whiteText < Self.minWhiteTextContrast && blackText > whiteText) }
    return blackText < Self.minBlackTextContrast && whiteText > blackText
  }
}

enum ThemeAxis {
  typealias Half = @Sendable (_ width: Double, _ height: Double, _ dx: Double, _ dy: Double) -> Double

  static func direction(_ degrees: Double) -> (dx: Double, dy: Double) {
    let radians = degrees * .pi / 180
    return (sin(radians), -cos(radians))
  }

  static let baseHalf: Half = { width, height, dx, dy in
    hypot(width * dx, height * dy) * hypot(width, height) / (2 * max(width, height))
  }

  static let overlayHalf: Half = { width, height, dx, dy in
    (width * abs(dx) + height * abs(dy)) / 2
  }

  static func along(_ degrees: Double, _ x: Double, _ y: Double, _ width: Double, _ height: Double, half: Half) -> Double {
    let (dx, dy) = direction(degrees)
    return ((x - width / 2) * dx + (y - height / 2) * dy) / (2 * half(width, height, dx, dy)) + 0.5
  }

  static func ends(_ degrees: Double, width: Double, height: Double, reach: Double, half: Half) -> (start: CGPoint, end: CGPoint) {
    let (dx, dy) = direction(degrees)
    let length = half(width, height, dx, dy)
    let start = CGPoint(x: width / 2 - length * dx, y: height / 2 - length * dy)
    return (start, CGPoint(x: start.x + 2 * length * reach * dx, y: start.y + 2 * length * reach * dy))
  }
}

enum Oklab {
  static func decode(_ value: Double) -> Double {
    let size = abs(value)
    return (value < 0 ? -1 : 1) * (size <= 0.04045 ? size / 12.92 : pow((size + 0.055) / 1.055, 2.4))
  }

  static func encode(_ value: Double) -> Double {
    let size = abs(value)
    return (value < 0 ? -1 : 1) * (size <= 0.0031308 ? size * 12.92 : 1.055 * pow(size, 1 / 2.4) - 0.055)
  }

  static func lab(_ color: LookRGB) -> (Double, Double, Double) {
    let (r, g, b) = (decode(color.red), decode(color.green), decode(color.blue))
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    )
  }

  static func rgb(_ lab: (Double, Double, Double)) -> LookRGB {
    let (lightness, a, b) = lab
    let l = pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
    let m = pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
    let s = pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3)
    return LookRGB(
      red: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      green: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      blue: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    )
  }

  static func mix(_ from: LookRGB, _ to: LookRGB, _ share: Double) -> LookRGB {
    let (a, b) = (lab(from), lab(to))
    return rgb((a.0 + (b.0 - a.0) * share, a.1 + (b.1 - a.1) * share, a.2 + (b.2 - a.2) * share))
  }
}

private func clamp01(_ value: Double) -> Double { min(1, max(0, value)) }

extension LookRGB {
  var relativeLuminance: Double {
    0.2126 * Oklab.decode(clamp01(red)) + 0.7152 * Oklab.decode(clamp01(green)) + 0.0722 * Oklab.decode(clamp01(blue))
  }
}
