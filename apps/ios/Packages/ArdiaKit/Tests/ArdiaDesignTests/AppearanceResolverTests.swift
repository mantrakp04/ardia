import ArdiaDesign
import ArdiaSync
import SwiftUI
import Testing

struct AppearanceResolverTests {
  private func resolve(
    style: InterfaceStyleChoice = .matchMac,
    scheme: ColorSchemeChoice = .matchMac,
    mac: SyncedLookSettings? = nil,
    sync: Bool = true
  ) -> ResolvedAppearance {
    AppearanceResolver.resolve(AppearanceChoices(interfaceStyle: style, colorScheme: scheme), mac: mac, syncIsOn: sync)
  }

  @Test func `a fresh install matches the Mac and the Mac has said nothing`() {
    let fresh = AppearanceChoices()
    #expect(fresh.interfaceStyle == .matchMac)
    #expect(fresh.colorScheme == .matchMac)
    #expect(resolve(mac: nil) == .macDefaults)
    #expect(resolve(mac: SyncedLookSettings()) == .macDefaults)
    #expect(resolve(mac: nil, sync: false) == .standard)
    #expect(ResolvedAppearance.macDefaults.interfaceStyle == .glass)
    #expect(ResolvedAppearance.macDefaults.glassTintAmount == 0)
    #expect(ResolvedAppearance.macDefaults.colorScheme == nil)
    #expect(ResolvedAppearance.standard.interfaceStyle == .glass)
    #expect(ResolvedAppearance.standard.glassTintAmount == GlassTint.defaultAmount)
    #expect(ResolvedAppearance.standard.colorScheme == nil)
  }

  @Test func `match my mac follows the Mac's interface style`() {
    #expect(resolve(mac: SyncedLookSettings(interfaceStyle: .classic)).interfaceStyle == .classic)
    #expect(resolve(mac: SyncedLookSettings(interfaceStyle: .glass)).interfaceStyle == .glass)
  }

  @Test func `a Mac that sends no interface style gives glass`() {
    #expect(resolve(mac: SyncedLookSettings(appearance: .dark)).interfaceStyle == .glass)
    #expect(resolve(mac: nil).interfaceStyle == .glass)
  }

  @Test func `a choice made on the device beats the Mac's interface style`() {
    for mac in [nil, SyncedLookSettings(), SyncedLookSettings(interfaceStyle: .glass), SyncedLookSettings(interfaceStyle: .classic)] {
      #expect(resolve(style: .glass, mac: mac).interfaceStyle == .glass)
      #expect(resolve(style: .classic, mac: mac).interfaceStyle == .classic)
    }
  }

  @Test func `with sync off nothing the Mac sent is used`() {
    let mac = SyncedLookSettings(appearance: .dark, interfaceStyle: .classic, glassTintWithTheme: true, glassTintAmount: 0.7)
    #expect(resolve(mac: mac, sync: false) == .standard)
    #expect(resolve(style: .glass, scheme: .system, mac: mac, sync: false) == .standard)
    #expect(resolve(style: .classic, scheme: .dark, mac: mac, sync: false).interfaceStyle == .classic)
    #expect(resolve(style: .classic, scheme: .dark, mac: mac, sync: false).colorScheme == .dark)
    #expect(resolve(style: .classic, scheme: .dark, mac: mac, sync: false).glassTintAmount == GlassTint.defaultAmount)
  }

  @Test func `match my mac follows the Mac's appearance`() {
    #expect(resolve(mac: SyncedLookSettings(appearance: .dark)).colorScheme == .dark)
    #expect(resolve(mac: SyncedLookSettings(appearance: .light)).colorScheme == .light)
    #expect(resolve(mac: SyncedLookSettings(appearance: .auto)).colorScheme == nil)
  }

  @Test func `a Mac that sends no appearance leaves the system in charge`() {
    #expect(resolve(mac: SyncedLookSettings(interfaceStyle: .classic)).colorScheme == nil)
    #expect(resolve(mac: nil).colorScheme == nil)
  }

  @Test func `a colour scheme chosen on the device beats the Mac's`() {
    for appearance in [nil, SyncedLookSettings.Appearance.auto, .light, .dark] {
      let mac = SyncedLookSettings(appearance: appearance)
      #expect(resolve(scheme: .system, mac: mac).colorScheme == nil)
      #expect(resolve(scheme: .light, mac: mac).colorScheme == .light)
      #expect(resolve(scheme: .dark, mac: mac).colorScheme == .dark)
    }
  }

  @Test func `the glass tint is the Mac's amount`() {
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: true, glassTintAmount: 0.5)).glassTintAmount == 0.5)
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: true, glassTintAmount: 0)).glassTintAmount == 0)
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: true)).glassTintAmount == AppearanceResolver.macDefaultGlassTintAmount)
  }

  @Test func `the Mac's own default amount is 0.8`() {
    #expect(AppearanceResolver.macDefaultGlassTintAmount == 0.8)
  }

  @Test func `a Mac with tint off gives no tint whatever its amount`() {
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: false, glassTintAmount: 0.8)).glassTintAmount == 0)
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: false)).glassTintAmount == 0)
  }

  @Test func `a Mac that sends no tint setting is clear, as the Mac draws it`() {
    #expect(resolve(mac: nil).glassTintAmount == 0)
    #expect(resolve(mac: SyncedLookSettings()).glassTintAmount == 0)
    #expect(resolve(mac: SyncedLookSettings(glassTintAmount: 0.8)).glassTintAmount == 0)
    #expect(resolve(mac: SyncedLookSettings(appearance: .dark, interfaceStyle: .classic)).glassTintAmount == 0)
  }

  @Test func `a Mac with tint on and an untouched slider gives the Mac's default amount`() {
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: true)).glassTintAmount == 0.8)
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: true, glassTintAmount: .nan)).glassTintAmount == 0.8)
  }

  @Test func `with sync off the tint is the device's own default`() {
    for mac in [nil, SyncedLookSettings(), SyncedLookSettings(glassTintWithTheme: true, glassTintAmount: 0.7), SyncedLookSettings(glassTintWithTheme: false)] {
      #expect(resolve(mac: mac, sync: false).glassTintAmount == GlassTint.defaultAmount)
    }
  }

  @Test func `the tint amount stays between 0 and 1`() {
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: true, glassTintAmount: 4)).glassTintAmount == 1)
    #expect(resolve(mac: SyncedLookSettings(glassTintWithTheme: true, glassTintAmount: -2)).glassTintAmount == 0)
  }

  @Test func `the tint follows the Mac whichever interface style the device picked`() {
    let mac = SyncedLookSettings(glassTintWithTheme: true, glassTintAmount: 0.4)
    #expect(resolve(style: .glass, mac: mac).glassTintAmount == 0.4)
    #expect(resolve(style: .classic, mac: mac).glassTintAmount == 0.4)
  }

  @Test func `every combination of choices resolves from its own two inputs`() {
    let appearances: [SyncedLookSettings.Appearance?] = [nil, .auto, .light, .dark]
    let styles: [SyncedLookSettings.InterfaceStyle?] = [nil, .glass, .classic]
    for sync in [true, false] {
      for styleChoice in InterfaceStyleChoice.allCases {
        for schemeChoice in ColorSchemeChoice.allCases {
          for appearance in appearances {
            for style in styles {
              let mac = SyncedLookSettings(appearance: appearance, interfaceStyle: style)
              let result = resolve(style: styleChoice, scheme: schemeChoice, mac: mac, sync: sync)
              #expect(result.interfaceStyle == Self.expectedStyle(styleChoice, style, sync))
              #expect(result.colorScheme == Self.expectedScheme(schemeChoice, appearance, sync))
            }
          }
        }
      }
    }
  }

  private static func expectedStyle(_ choice: InterfaceStyleChoice, _ mac: SyncedLookSettings.InterfaceStyle?, _ sync: Bool) -> InterfaceStyle {
    switch choice {
    case .glass: .glass
    case .classic: .classic
    case .matchMac: sync && mac == .classic ? .classic : .glass
    }
  }

  private static func expectedScheme(_ choice: ColorSchemeChoice, _ mac: SyncedLookSettings.Appearance?, _ sync: Bool) -> ColorScheme? {
    switch choice {
    case .system: return nil
    case .light: return .light
    case .dark: return .dark
    case .matchMac:
      guard sync else { return nil }
      switch mac {
      case .light: return .light
      case .dark: return .dark
      case .auto, nil: return nil
      }
    }
  }

  @Test func `the pickers show what the device really does when sync is off`() {
    let matching = AppearanceChoices()
    #expect(matching.shown(syncIsOn: true) == matching)
    let off = matching.shown(syncIsOn: false)
    #expect(off.interfaceStyle == .glass)
    #expect(off.colorScheme == .system)
    let chosen = AppearanceChoices(interfaceStyle: .classic, colorScheme: .dark)
    #expect(chosen.shown(syncIsOn: false) == chosen)
    #expect(chosen.shown(syncIsOn: true) == chosen)
  }

  @Test func `the choices have the words the pages show`() {
    #expect(InterfaceStyleChoice.allCases == [.matchMac, .glass, .classic])
    #expect(ColorSchemeChoice.allCases == [.matchMac, .system, .light, .dark])
    #expect(InterfaceStyleChoice(rawValue: "classic") == .classic)
    #expect(ColorSchemeChoice(rawValue: "dark") == .dark)
    #expect(InterfaceStyleChoice(rawValue: "nonsense") == nil)
  }
}
