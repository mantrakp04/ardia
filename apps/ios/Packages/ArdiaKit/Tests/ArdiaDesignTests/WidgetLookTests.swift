import ArdiaDesign
import ArdiaSync
import Foundation
import SwiftUI
import Testing

struct WidgetLookTests {
  static let theme = SyncedTheme(
    colors: ["#1E2A5A", "#3A2466"],
    darkColors: nil,
    mode: .auto,
    light: SyncedTheme.Look(
      stops: [
        SyncedTheme.Stop(red: 0.12, green: 0.16, blue: 0.35, alpha: 0.9, x: 0.2, y: 0.3),
        SyncedTheme.Stop(red: 0.23, green: 0.14, blue: 0.4, alpha: 0.6, x: 0.8, y: 0.7),
      ],
      intensity: 0.8,
      grain: 0.4,
      texture: .sand,
      translucency: 0.5,
      angle: 200
    ),
    dark: nil
  )

  static func profile(_ theme: SyncedTheme?, color: String? = "blue") -> SyncedProfile {
    SyncedProfile(syncId: "p", name: "Space", color: color, icon: nil, isDefault: true, theme: theme, deviceTabs: [], pinned: PinnedArea(), bookmarks: [], history: [])
  }

  @Test func `the widget draws a space with the same look as the app`() {
    let space = Self.profile(Self.theme)
    let snapshot = SystemSnapshot(isSyncEnabled: true, color: space.color, theme: space.theme)
    #expect(snapshot.look == ProfileLook(profile: space))
    for dark in [false, true] {
      #expect(snapshot.look.backdrop(dark: dark) == ProfileLook(profile: space).backdrop(dark: dark))
      #expect(snapshot.look.inkIsLight(dark: dark) == ProfileLook(profile: space).inkIsLight(dark: dark))
    }
  }

  @Test func `the whole theme survives the trip to the widget`() throws {
    let space = Self.profile(Self.theme)
    let sent = SystemSnapshot(isSyncEnabled: true, color: space.color, theme: space.theme)
    let received = try JSONDecoder().decode(SystemSnapshot.self, from: JSONEncoder().encode(sent))
    #expect(received.theme == Self.theme)
    #expect(received.look == ProfileLook(profile: space))
  }

  @Test func `a snapshot written before the theme was added still draws its gradient`() throws {
    let old = ##"{"version":1,"isSyncEnabled":true,"macTabs":[],"sendTargets":[],"gradient":["#1E2A5A","#3A2466"],"color":"blue"}"##
    let received = try JSONDecoder().decode(SystemSnapshot.self, from: Data(old.utf8))
    #expect(received.theme == nil)
    #expect(received.look == ProfileLook(colorName: "blue", themeColors: ["#1E2A5A", "#3A2466"], darkThemeColors: nil))
  }

  @Test func `a colour chosen on the device wins in the widget as in the app`() {
    let snapshot = SystemSnapshot(isSyncEnabled: true, color: "green", theme: nil)
    #expect(snapshot.look == ProfileLook(preset: .green))
  }

  @Test func `a profile with no theme draws its colour the same in both`() {
    let space = Self.profile(nil, color: "orange")
    let snapshot = SystemSnapshot(isSyncEnabled: true, color: space.color, theme: space.theme)
    #expect(snapshot.look == ProfileLook(profile: space))
  }
}
