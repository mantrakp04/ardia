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

  @Test func `a Mac theme replaces the start gradient`() {
    let themed = ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"], darkThemeColors: ["#1E2A5A", "#3A2466"])
    #expect(themed.launchHexes(dark: false) == ["#4F7CFF", "#9B6BFF"])
    #expect(themed.launchHexes(dark: true) == ["#1E2A5A", "#3A2466"])
    let lightOnly = ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"])
    #expect(lightOnly.launchHexes(dark: true) == ["#4F7CFF", "#9B6BFF"])
  }

  @Test func `a profile color without a theme draws its own start gradient`() {
    let plum = ProfileLook.plum.launchHexes(dark: false)
    #expect(plum.count == 4)
    #expect(plum.suffix(3) == ["#B25B6B", "#C07A98", "#DD899B"])
    #expect(ProfileLook(colorName: "blue").launchHexes(dark: false) != plum)
    #expect(ProfileLook(colorName: "blue", themeColors: ["#4F7CFF"]).launchHexes(dark: false).count == 4)
    #expect(ProfileLook(colorName: "blue", themeColors: ["nope"]) == ProfileLook(preset: .blue))
  }

  @Test func `the cover gradient under white text is the theme, or a deep run of the profile color`() {
    for preset in ProfileLook.Preset.allCases {
      let cover = ProfileLook(preset: preset).coverStops()
      #expect(cover.count == 4)
      #expect(cover[0].hsl.lightness < cover[1].hsl.lightness, "\(preset)")
      #expect(cover.allSatisfy { $0.contrastWithWhite >= 4.45 }, "\(preset)")
    }
    #expect(ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"]).coverHexes == ["#4F7CFF", "#9B6BFF"])
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
