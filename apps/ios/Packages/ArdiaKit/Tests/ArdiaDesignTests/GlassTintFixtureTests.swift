import ArdiaDesign
import Foundation
import Testing

struct GlassTintFixtureTests {
  private struct Fixture: Decodable {
    struct Control: Decodable {
      let preset: String
      let dark: Bool
      let state: String
      let amount: Double
      let tint: String
    }

    struct Panel: Decodable {
      let preset: String
      let dark: Bool
      let amount: Double
      let tint: String
    }

    let controls: [Control]
    let panels: [Panel]
  }

  private static func load() throws -> Fixture {
    let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: package.appending(path: "Fixtures/glass-tints.json")))
  }

  private func bytes(_ colour: TokenColor) -> [Int] {
    [colour.red, colour.green, colour.blue, colour.opacity].map { Int(($0 * 255).rounded()) }
  }

  private func bytes(hex: String) throws -> [Int] {
    let digits = try #require(UInt32(hex.dropFirst(), radix: 16))
    return [24, 16, 8, 0].map { Int((digits >> $0) & 0xFF) }
  }

  private func matches(_ colour: TokenColor, _ hex: String) throws -> Bool {
    try zip(bytes(colour), bytes(hex: hex)).allSatisfy { abs($0 - $1) <= 1 }
  }

  @Test func `control glass matches the Mac's controlGlassTint for every state, scheme and amount`() throws {
    let fixture = try Self.load()
    #expect(fixture.controls.count >= 64)
    for control in fixture.controls {
      let state = try #require(GlassState(rawValue: control.state))
      let tint = GlassTint.control(state, dark: control.dark, amount: control.amount)
      #expect(try matches(tint, control.tint), "\(control.preset) \(control.dark ? "dark" : "light") \(control.state) \(control.amount): \(bytes(tint)) is not \(control.tint)")
    }
  }

  @Test func `panel glass matches the Mac's panelGlassTint for every preset and scheme`() throws {
    let fixture = try Self.load()
    #expect(fixture.panels.count >= 16)
    for panel in fixture.panels {
      let preset = try #require(ProfileLook.Preset(rawValue: panel.preset))
      let tint = GlassTint.panel(dark: panel.dark, look: ProfileLook(preset: preset), amount: panel.amount)
      #expect(try matches(tint, panel.tint), "\(panel.preset) \(panel.dark ? "dark" : "light") \(panel.amount): \(bytes(tint)) is not \(panel.tint)")
    }
  }
}
