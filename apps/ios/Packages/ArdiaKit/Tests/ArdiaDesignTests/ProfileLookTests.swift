import Foundation
import Testing
@testable import ArdiaDesign

struct ProfileLookTests {
  static let macWindowTints: [(ProfileLook.Preset, light: [UInt32], dark: [UInt32])] = [
    (.plum, [0xE7CFD3, 0xF2E7E9], [0x342123, 0x3B3031]),
    (.blue, [0xD0DDE7, 0xE7EDF2], [0x242A30, 0x343537]),
    (.purple, [0xD2CFE7, 0xE8E7F2], [0x262130, 0x353037]),
    (.pink, [0xE7CFD3, 0xF2E7E9], [0x342123, 0x3B3031]),
    (.red, [0xE7CFD0, 0xF2E7E7], [0x342121, 0x3B3030]),
    (.orange, [0xE7D6CF, 0xF2EAE6], [0x342520, 0x3B3230]),
    (.yellow, [0xE7DFCF, 0xF2EEE6], [0x342B20, 0x3B3530]),
    (.green, [0xD0E7DE, 0xE7F2ED], [0x24302A, 0x343834]),
    (.neutral, [0xF0F0F0, 0xF6F5F5], [0x1F1B1A, 0x231F1E]),
  ]

  static func isClose(_ stops: [LookRGB], _ expected: [UInt32]) -> Bool {
    guard stops.count == expected.count else { return false }
    return zip(stops, expected.map(LookRGB.init(hex:))).allSatisfy { stop, want in
      abs(stop.red - want.red) <= 1.01 / 255 && abs(stop.green - want.green) <= 1.01 / 255 && abs(stop.blue - want.blue) <= 1.01 / 255
    }
  }

  @Test func `the window tint matches the Mac for every profile color`() {
    #expect(Self.macWindowTints.count == ProfileLook.Preset.allCases.count)
    for (preset, light, dark) in Self.macWindowTints {
      let look = ProfileLook(preset: preset)
      #expect(Self.isClose(look.windowTintStops(dark: false), light), "\(preset) light")
      #expect(Self.isClose(look.windowTintStops(dark: true), dark), "\(preset) dark")
    }
  }

  @Test func `the incognito tint matches the Mac`() {
    #expect(Self.isClose(ProfileLook.incognito.windowTintStops(dark: true), [0x1A1616, 0x1E1A19]))
  }

  @Test func `profile color names are the Mac's, and plum is the default`() {
    #expect(ProfileLook(colorName: "Blue") == ProfileLook(preset: .blue))
    #expect(ProfileLook(colorName: "plum") == .plum)
    #expect(ProfileLook(colorName: nil) == .plum)
    #expect(ProfileLook(colorName: "indigo") == .plum)
    #expect(ProfileLook(colorName: "#4691C3").swatch == LookRGB(hex: 0x4691C3))
  }

  @Test func `the backdrop is the Mac's window tint, and a Mac theme replaces it where themes show`() {
    for dark in [false, true] {
      #expect(ProfileLook.plum.backdropStops(dark: dark, themed: true) == ProfileLook.plum.windowTintStops(dark: dark))
    }
    let themed = ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"], darkThemeColors: ["#1E2A5A", "#3A2466"])
    #expect(themed.backdropStops(dark: false, themed: true).map(\.hexString) == ["#4F7CFF", "#9B6BFF"])
    #expect(themed.backdropStops(dark: true, themed: true).map(\.hexString) == ["#1E2A5A", "#3A2466"])
    #expect(themed.backdropStops(dark: false, themed: false) == themed.windowTintStops(dark: false))
    #expect(themed.backdropStops(dark: true, themed: false) == themed.windowTintStops(dark: true))
    let lightOnly = ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"])
    #expect(lightOnly.backdropStops(dark: true, themed: true).map(\.hexString) == ["#4F7CFF", "#9B6BFF"])
    let oneColor = ProfileLook(colorName: "blue", themeColors: ["#4F7CFF"])
    #expect(oneColor.backdropStops(dark: false, themed: true) == oneColor.windowTintStops(dark: false))
    #expect(ProfileLook(colorName: "blue", themeColors: ["nope"]) == ProfileLook(preset: .blue))
  }

  @Test func `incognito is dark in both appearances`() {
    #expect(ProfileLook.incognito.backdropStops(dark: false, themed: true) == ProfileLook.incognito.windowTintStops(dark: true))
    #expect(ProfileLook.incognito.inkIsLight(dark: false, themed: true))
  }

  @Test func `text on the backdrop takes the ink that reads on it`() {
    for preset in ProfileLook.Preset.allCases {
      let look = ProfileLook(preset: preset)
      #expect(!look.inkIsLight(dark: false, themed: true), "\(preset) light")
      #expect(look.inkIsLight(dark: true, themed: true), "\(preset) dark")
    }
    let deepTheme = ProfileLook(colorName: "blue", themeColors: ["#1E2A5A", "#3A2466"])
    #expect(deepTheme.inkIsLight(dark: false, themed: true))
    #expect(!deepTheme.inkIsLight(dark: false, themed: false))
    let paleTheme = ProfileLook(colorName: "blue", themeColors: ["#F4E9D8", "#E9F4D8"])
    #expect(!paleTheme.inkIsLight(dark: true, themed: true))
  }

  @Test func `a look knows which of the Mac's colors it is`() {
    for preset in ProfileLook.Preset.allCases {
      #expect(ProfileLook(preset: preset).preset == preset)
      #expect(ProfileLook(colorName: preset.rawValue).preset == preset)
    }
    #expect(ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"]).preset == nil)
  }

  @Test func `a widget snapshot carries the look, and one saved before it did is plum`() throws {
    let chosen = SystemSnapshot(color: "green")
    #expect(chosen.look == ProfileLook(preset: .green))
    let themed = SystemSnapshot(isSyncEnabled: true, gradient: ["#4F7CFF", "#9B6BFF"], darkGradient: ["#1E2A5A", "#3A2466"], color: "green")
    #expect(themed.look == ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"], darkThemeColors: ["#1E2A5A", "#3A2466"]))
    let roundTrip = try JSONDecoder().decode(SystemSnapshot.self, from: JSONEncoder().encode(themed))
    #expect(roundTrip == themed)
    let earlier = Data(#"{"version":1,"isSyncEnabled":false,"macTabs":[],"sendTargets":[],"gradient":[]}"#.utf8)
    #expect(try JSONDecoder().decode(SystemSnapshot.self, from: earlier).look == .plum)
  }

  @Test func `the deck backdrop follows the profile color`() {
    for dark in [false, true] {
      #expect(ProfileLook.plum.deckBaseStops(dark: dark).count == 6)
      #expect(ProfileLook.plum.deckBlobStops(dark: dark).count == 3)
      #expect(ProfileLook.plum.deckBaseStops(dark: dark) != ProfileLook(preset: .green).deckBaseStops(dark: dark))
    }
    let grey = ProfileLook(preset: .neutral).deckBlobStops(dark: false)
    #expect(grey.allSatisfy { $0.hsl.saturation < 0.01 })
  }
}
