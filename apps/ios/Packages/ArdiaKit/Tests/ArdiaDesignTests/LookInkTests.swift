import ArdiaDesign
import SwiftUI
import Testing

struct LookInkTests {
  @Test func `a preset reads with the ink of the app's scheme`() {
    for preset in ProfileLook.Preset.allCases {
      let look = ProfileLook(preset: preset)
      #expect(look.inkScheme(appDark: false) == .light, "\(preset) light")
      #expect(look.inkScheme(appDark: true) == .dark, "\(preset) dark")
    }
  }

  @Test func `incognito reads dark in both appearances`() {
    #expect(ProfileLook.incognito.inkScheme(appDark: false) == .dark)
    #expect(ProfileLook.incognito.inkScheme(appDark: true) == .dark)
  }

  @Test func `a deep theme forces dark content even in a light app`() {
    let deep = ProfileLook(colorName: "blue", themeColors: ["#1E2A5A", "#3A2466"])
    #expect(deep.inkScheme(appDark: false) == .dark)
    #expect(deep.inkScheme(appDark: true) == .dark)
  }

  @Test func `a pale theme keeps light content until the Mac darkens it`() {
    let pale = ProfileLook(colorName: "blue", themeColors: ["#F4E9D8", "#E9F4D8"])
    #expect(pale.inkScheme(appDark: false) == .light)
    #expect(pale.inkScheme(appDark: true) == .dark)
  }
}
