import ArdiaDesign
import ArdiaSync
import SwiftUI
import Testing

struct OnboardingSurfaceTests {
  static let deep = ProfileLook(colorName: "blue", themeColors: ["#1E2A5A", "#3A2466"])
  static let pale = ProfileLook(colorName: "blue", themeColors: ["#F4E9D8", "#E9F4D8"])
  static let paleInDark = ProfileLook(colorName: "blue", themeColors: ["#1E2A5A", "#3A2466"], darkThemeColors: ["#F4E9D8", "#E9F4D8"])
  static let looks: [(String, ProfileLook)] = [
    ("plum", .plum), ("incognito", .incognito), ("deep", deep), ("pale", pale), ("paleInDark", paleInDark),
  ]

  @Test func `the welcome step and every wide step sit on the space`() {
    for composition in PageComposition.allCases {
      #expect(OnboardingSurface(isWelcome: true, composition: composition) == .space)
    }
    #expect(OnboardingSurface(isWelcome: false, composition: .column) == .space)
    #expect(OnboardingSurface(isWelcome: false, composition: .sideBySide) == .space)
  }

  @Test func `a stacked step after the welcome sits on the system surface`() {
    #expect(OnboardingSurface(isWelcome: false, composition: .stacked) == .system)
  }

  @Test func `a deep theme in light mode keeps dark text on the system surface`() {
    let surface = OnboardingSurface(isWelcome: false, composition: .stacked)
    #expect(surface.inkScheme(look: Self.deep, appDark: false) == .light)
    #expect(!surface.isDark(look: Self.deep, appDark: false))
  }

  @Test func `a deep theme in light mode gets light text on the space it is drawn on`() {
    #expect(OnboardingSurface.space.inkScheme(look: Self.deep, appDark: false) == .dark)
    #expect(OnboardingSurface.space.isDark(look: Self.deep, appDark: false))
  }

  @Test func `a pale dark look keeps light text on the system surface in dark mode`() {
    let surface = OnboardingSurface(isWelcome: false, composition: .stacked)
    #expect(surface.inkScheme(look: Self.paleInDark, appDark: true) == .dark)
    #expect(surface.isDark(look: Self.paleInDark, appDark: true))
  }

  @Test func `a pale dark look gets dark text on the space it is drawn on`() {
    #expect(OnboardingSurface.space.inkScheme(look: Self.paleInDark, appDark: true) == .light)
    #expect(!OnboardingSurface.space.isDark(look: Self.paleInDark, appDark: true))
  }

  @Test func `ink and surface agree for every step, composition, look and scheme`() {
    for isWelcome in [true, false] {
      for composition in PageComposition.allCases {
        let surface = OnboardingSurface(isWelcome: isWelcome, composition: composition)
        for (name, look) in Self.looks {
          for appDark in [false, true] {
            let ink = surface.inkScheme(look: look, appDark: appDark)
            let expected: ColorScheme = surface.isDark(look: look, appDark: appDark) ? .dark : .light
            #expect(ink == expected, "\(name) welcome \(isWelcome) \(composition) dark \(appDark)")
          }
        }
      }
    }
  }

  @Test func `only the space surface follows the space's ink`() {
    #expect(OnboardingSurface.space.followsSpaceInk)
    #expect(!OnboardingSurface.system.followsSpaceInk)
  }
}
