import Foundation

public extension TokenColor {
  var luminance: Double {
    func linear(_ value: Double) -> Double {
      value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }

  func contrast(with other: TokenColor) -> Double {
    let lighter = max(luminance, other.luminance)
    let darker = min(luminance, other.luminance)
    return (lighter + 0.05) / (darker + 0.05)
  }
}

public enum LegibleTint {
  public static let standardContrast = 4.5
  public static let increasedContrast = 7.0
  static let step = 0.03

  public static func ink(_ tint: TokenColor, on surfaces: [TokenColor], dark: Bool, increasedContrast: Bool) -> TokenColor {
    let target = increasedContrast ? Self.increasedContrast : standardContrast
    let destination = dark ? TokenColor(hex: 0xFFFFFF) : TokenColor(hex: 0x000000)
    var amount = 0.0
    var candidate = tint
    while amount < 1, surfaces.contains(where: { candidate.contrast(with: $0) < target }) {
      amount = min(1, amount + step)
      candidate = tint.mixed(toward: destination, by: amount)
    }
    return candidate
  }
}

public extension ProfileLook {
  func surfaceColors(dark: Bool) -> [TokenColor] {
    backdropStops(dark: dark, themed: true).map { TokenColor(red: $0.red, green: $0.green, blue: $0.blue) }
  }
}
