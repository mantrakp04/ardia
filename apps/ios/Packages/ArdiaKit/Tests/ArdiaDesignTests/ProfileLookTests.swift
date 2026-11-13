import ArdiaSync
import Foundation
import SwiftUI
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
    #expect(!paleTheme.inkIsLight(dark: false, themed: true))
    #expect(paleTheme.inkIsLight(dark: true, themed: true), "the Mac darkens a light-only theme that doesn't read in dark")
    #expect(paleTheme.backdropStops(dark: true, themed: true).map(\.hexString) == ["#625D56", "#5D6256"])
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

  @Test func `theme colors with transparency keep their stop, as 8-digit hex`() throws {
    let look = ProfileLook(colorName: "blue", themeColors: ["#FF8000", "#0000FF80"])
    #expect(look.themeStops(dark: false).map(\.hexString) == ["#FF8000", "#0000FF"])
    #expect(look.showsTheme(dark: false, themed: true))
    #expect(LookRGB(hexString: "#0000FF80") == LookRGB(hex: 0x0000FF))
    #expect(LookRGB(hexString: "#0000FF8") == nil)
    let translucent = try #require(Color(hexString: "#0000FF80"))
    #expect(translucent == Color(.sRGB, red: 0, green: 0, blue: 1, opacity: Double(0x80) / 255))
    #expect(Color(hexString: "#12345") == nil)
  }

  struct BackdropFixture: Decodable {
    struct Expect: Decodable {
      var requestedDark: Bool
      var dark: Bool
      var stops: [[Double]]
      var angle: Double
      var layerAlpha: Double
      var underlayAlpha: Double
      var grainAlpha: Double
      var texture: String
      var under: String
      var tint: [String]
      var accent: String
      var luminance: Double
      var samples: [[Double]]
    }

    struct Case: Decodable {
      var name: String
      var theme: SyncedTheme
      var appDark: Bool
      var followsAppearance: Bool
      var samples: [[Double]]
      var expect: Expect
    }

    var cases: [Case]

    static func load() throws -> BackdropFixture {
      var root = URL(fileURLWithPath: #filePath)
      for _ in 0..<7 { root.deleteLastPathComponent() }
      let url = root.appending(path: "apps/browser/src/state/sync/fixtures/theme-backdrops.json")
      return try JSONDecoder().decode(BackdropFixture.self, from: Data(contentsOf: url))
    }
  }

  static let relativeTolerance = 1e-9

  static func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) <= relativeTolerance * max(1, abs(a), abs(b)) }

  @Test func `a synced theme is shown, composited and sampled with the Mac's own numbers`() throws {
    let fixture = try BackdropFixture.load()
    #expect(fixture.cases.count >= 10)
    for item in fixture.cases {
      let want = item.expect
      let shown = try #require(item.theme.shown(appDark: item.appDark, followsAppearance: item.followsAppearance))
      let look = shown.look
      #expect(shown.requestedDark == want.requestedDark, "\(item.name)")
      #expect(shown.dark == want.dark, "\(item.name)")
      #expect(look.stops.map { [$0.red, $0.green, $0.blue, $0.alpha] }.elementsEqual(want.stops) { zip($0, $1).allSatisfy { Self.near($0, $1) } }, "\(item.name) stops")
      #expect(Self.near(look.angle, want.angle), "\(item.name) angle")
      #expect(Self.near(look.layerAlpha, want.layerAlpha), "\(item.name) layer")
      #expect(Self.near(look.underlayAlpha(dark: shown.dark), want.underlayAlpha), "\(item.name) underlay")
      #expect(Self.near(look.grainAlpha, want.grainAlpha), "\(item.name) grain")
      #expect(look.texture.rawValue == want.texture, "\(item.name)")
      #expect(look.under(dark: shown.dark).hexString == want.under, "\(item.name) under")
      #expect(look.opaqueTint(dark: shown.dark).map(\.hexString) == want.tint, "\(item.name) tint")
      #expect(look.accent.hexString == want.accent, "\(item.name) accent")
      #expect(Self.near(look.luminance(dark: shown.dark), want.luminance), "\(item.name) luminance")
      for (sample, expected) in zip(item.samples, want.samples) {
        let area = look.area(x: sample[0], y: sample[1], width: sample[2], height: sample[3])
        #expect(Self.near(area.red, expected[0]) && Self.near(area.green, expected[1]) && Self.near(area.blue, expected[2]), "\(item.name) at \(sample)")
      }
    }
  }

  @Test func `textures are the Mac's tiles byte for byte`() {
    let mac: [(SyncedTheme.Texture, UInt64)] = [
      (.grain, 0xf1d3_2f92_f1e2_2ea9),
      (.sand, 0x0a08_6e62_6fba_9dbf),
      (.denim, 0xe169_5685_210e_d160),
      (.tweed, 0xd6e7_41c7_130d_97c7),
    ]
    for (texture, hash) in mac {
      let bytes = TextureTile.bytes(texture)
      #expect(bytes.count == TextureTile.side * TextureTile.side * 4)
      let fnv = bytes.reduce(UInt64(0xcbf2_9ce4_8422_2325)) { ($0 ^ UInt64($1)) &* 0x0000_0100_0000_01b3 }
      #expect(fnv == hash, "\(texture)")
    }
  }

  static func space(theme: SyncedTheme?) -> SyncedProfile {
    SyncedProfile(syncId: "p", name: "Space", color: "green", icon: nil, isDefault: true, theme: theme, deviceTabs: [], pinned: PinnedArea(), bookmarks: [], history: [])
  }

  @Test func `every screen asks one function for a space's backdrop`() throws {
    let fixture = try BackdropFixture.load()
    let theme = try #require(fixture.cases.first { $0.name == "three stops with alpha and a dark look, light app" }?.theme)
    let look = ProfileLook(profile: Self.space(theme: theme))
    for dark in [false, true] {
      let backdrop = look.backdrop(dark: dark)
      let shown = try #require(theme.shown(appDark: dark, followsAppearance: true))
      #expect(backdrop.fill == .theme(shown.look, dark: shown.dark))
      #expect(backdrop.isDark == shown.dark)
      #expect(look.backdropStops(dark: dark, themed: true) == shown.look.opaqueTint(dark: shown.dark).map(\.snapped))
      #expect(look.inkIsLight(dark: dark, themed: true) == shown.dark)
      #expect(look.backdrop(dark: dark, themed: false).fill == .tint(look.windowTintStops(dark: dark)))
    }
    #expect(look.swatch == theme.light!.accent.snapped)
    let preset = ProfileLook(preset: .green)
    #expect(preset.backdrop(dark: false).fill == .tint(preset.windowTintStops(dark: false)))
    #expect(!preset.backdrop(dark: false).isDark)
    #expect(preset.backdrop(dark: true).isDark)
    #expect(ProfileLook.incognito.backdrop(dark: false).isDark)
    let gradientOnly = ProfileLook(profile: Self.space(theme: SyncedTheme(colors: ["#4F7CFF", "#9B6BFF"], darkColors: nil)))
    #expect(gradientOnly.backdropStops(dark: false, themed: true).map(\.hexString) == ["#4F7CFF", "#9B6BFF"])
    #expect(gradientOnly == ProfileLook(colorName: "green", themeColors: ["#4F7CFF", "#9B6BFF"]))
  }

  @MainActor
  static func pixels(of view: some View, width: Int, height: Int) throws -> (Int, Int) -> LookRGB {
    let renderer = ImageRenderer(content: view.frame(width: CGFloat(width), height: CGFloat(height)))
    renderer.scale = 1
    let image = try #require(renderer.cgImage)
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = try #require(CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return { x, y in
      let index = (y * width + x) * 4
      return LookRGB(red: Double(bytes[index]) / 255, green: Double(bytes[index + 1]) / 255, blue: Double(bytes[index + 2]) / 255)
    }
  }

  @MainActor
  @Test func `the drawn theme is the Mac's composite at every point, in a tall and a wide window`() throws {
    let look = SyncedTheme.Look(
      stops: [.init(red: 0.2, green: 0.45, blue: 0.9), .init(red: 0.9, green: 0.35, blue: 0.55), .init(red: 0.95, green: 0.85, blue: 0.2, alpha: 0.8)],
      intensity: 0.7,
      translucency: 0.6,
      angle: 300
    )
    for (width, height) in [(120, 260), (300, 140)] {
      for dark in [false, true] {
        let pixel = try Self.pixels(of: ThemeBackdrop(look: look, dark: dark), width: width, height: height)
        let alpha = look.layerAlpha
        let grey = look.under(dark: dark).red
        for (x, y) in [(2, 2), (width - 3, height - 3), (width / 2, height / 2), (width / 4, height * 3 / 4), (width - 10, 8)] {
          let area = look.area(x: Double(x) + 0.5, y: Double(y) + 0.5, width: Double(width), height: Double(height))
          let want = [area.red, area.green, area.blue].map { alpha * min(1, max(0, $0)) + (1 - alpha) * grey }
          let got = pixel(x, y)
          let off = zip([got.red, got.green, got.blue], want).map { abs($0 - $1) }.max()!
          #expect(off <= 4.0 / 255, "\(width)x\(height) dark \(dark) at (\(x), \(y)): \(got) vs \(want)")
        }
      }
    }
  }
}
