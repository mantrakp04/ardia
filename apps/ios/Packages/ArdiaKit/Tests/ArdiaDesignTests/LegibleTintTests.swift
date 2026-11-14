import ArdiaDesign
import Testing

struct LegibleTintTests {
  static let red = TokenColor(hex: 0xFF3B30)
  static let orange = TokenColor(hex: 0xFF9500)
  static let green = TokenColor(hex: 0x34C759)
  static let white = TokenColor(hex: 0xFFFFFF)
  static let nearBlack = TokenColor(hex: 0x1C1C1E)
  static let navy = TokenColor(hex: 0x1E2A5A)
  static let pale = TokenColor(hex: 0xF4E9D8)

  @Test func `the ink reads on every surface it is asked to read on`() {
    for tint in [Self.red, Self.orange, Self.green] {
      for (surfaces, dark) in [([Self.white, Self.pale], false), ([Self.nearBlack, Self.navy], true)] {
        let ink = LegibleTint.ink(tint, on: surfaces, dark: dark, increasedContrast: false)
        for surface in surfaces {
          #expect(ink.contrast(with: surface) >= 4.5, "\(tint) on \(surface)")
        }
      }
    }
  }

  @Test func `surfaces no colour can read on at once still end, at the end of the range`() {
    let ink = LegibleTint.ink(Self.red, on: [Self.white, Self.navy], dark: true, increasedContrast: false)
    #expect(ink == TokenColor(hex: 0xFFFFFF))
  }

  @Test func `increased contrast asks for 7`() {
    let ink = LegibleTint.ink(Self.orange, on: [Self.white], dark: false, increasedContrast: true)
    #expect(ink.contrast(with: Self.white) >= 7)
  }

  @Test func `a tint that already reads is left alone`() {
    let dark = TokenColor(hex: 0x7A0000)
    #expect(LegibleTint.ink(dark, on: [Self.white], dark: false, increasedContrast: false) == dark)
  }

  @Test func `red on a deep theme is measured against the theme and not a fixed grey`() {
    let onNearBlack = Self.red.contrast(with: Self.nearBlack)
    let onNavy = Self.red.contrast(with: Self.navy)
    #expect(onNearBlack >= 4.5)
    #expect(onNavy < 4.5)
    let ink = LegibleTint.ink(Self.red, on: [Self.navy], dark: true, increasedContrast: false)
    #expect(ink.contrast(with: Self.navy) >= 4.5)
    #expect(ink != Self.red)
  }

  @Test func `the ink moves toward white in dark and toward black in light`() {
    let light = LegibleTint.ink(Self.orange, on: [Self.white], dark: false, increasedContrast: false)
    let dark = LegibleTint.ink(Self.red, on: [Self.navy], dark: true, increasedContrast: false)
    #expect(light.red < Self.orange.red)
    #expect(dark.green > Self.red.green)
  }

  @Test func `a space's surfaces are the stops of the backdrop it draws`() {
    let deep = ProfileLook(colorName: "blue", themeColors: ["#1E2A5A", "#3A2466"])
    let surfaces = deep.surfaceColors(dark: false)
    #expect(!surfaces.isEmpty)
    for surface in surfaces {
      #expect(surface.luminance < 0.1)
    }
    let plum = ProfileLook.plum.surfaceColors(dark: false)
    for surface in plum {
      #expect(surface.luminance > 0.5)
    }
  }

  @Test func `contrast is symmetric and runs from 1 to 21`() {
    #expect(Self.white.contrast(with: Self.white) == 1)
    #expect(abs(TokenColor(hex: 0x000000).contrast(with: Self.white) - 21) < 0.001)
    #expect(Self.red.contrast(with: Self.navy) == Self.navy.contrast(with: Self.red))
  }
}
