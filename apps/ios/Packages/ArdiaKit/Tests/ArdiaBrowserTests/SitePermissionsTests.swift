import Foundation
import Testing
@testable import ArdiaBrowser

@MainActor
@Suite struct SitePermissionsTests {
  private func freshDefaults() -> UserDefaults {
    let name = "site-permissions-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  @Test func originDropsDefaultPortsAndKeepsOthers() {
    #expect(SitePermissions.origin(scheme: "https", host: "Meet.Google.com", port: 443) == "https://meet.google.com")
    #expect(SitePermissions.origin(scheme: "http", host: "example.com", port: 80) == "http://example.com")
    #expect(SitePermissions.origin(scheme: "https", host: "example.com", port: 0) == "https://example.com")
    #expect(SitePermissions.origin(scheme: "http", host: "localhost", port: 8080) == "http://localhost:8080")
  }

  @Test func grantsAreRememberedAcrossLaunches() {
    let defaults = freshDefaults()
    let first = SitePermissions(defaults: defaults)
    first.allow([.camera, .microphone], origin: "https://meet.google.com", host: "meet.google.com")
    first.allow([.location], origin: "https://maps.apple.com", host: "maps.apple.com")
    let relaunched = SitePermissions(defaults: defaults)
    #expect(relaunched.grants.map(\.host) == ["maps.apple.com", "meet.google.com"])
    #expect(relaunched.allows([.camera], origin: "https://meet.google.com"))
    #expect(relaunched.allows([.camera, .microphone], origin: "https://meet.google.com"))
    #expect(!relaunched.allows([.location], origin: "https://meet.google.com"))
    #expect(!relaunched.allows([.camera], origin: "http://meet.google.com"))
  }

  @Test func askingForBothNeedsBoth() {
    let permissions = SitePermissions(defaults: freshDefaults())
    permissions.allow([.microphone], origin: "https://music.youtube.com", host: "music.youtube.com")
    #expect(permissions.allows([.microphone], origin: "https://music.youtube.com"))
    #expect(!permissions.allows([.camera, .microphone], origin: "https://music.youtube.com"))
    permissions.allow([.camera], origin: "https://music.youtube.com", host: "music.youtube.com")
    #expect(permissions.allows([.camera, .microphone], origin: "https://music.youtube.com"))
    #expect(permissions.grants.count == 1)
    #expect(permissions.grants.first?.summary == "Camera and Microphone")
  }

  @Test func revokingOneLeavesTheRestAndRevokingTheLastRemovesTheSite() {
    let defaults = freshDefaults()
    let permissions = SitePermissions(defaults: defaults)
    permissions.allow([.camera, .microphone], origin: "https://meet.google.com", host: "meet.google.com")
    permissions.revoke(.camera, origin: "https://meet.google.com")
    #expect(!permissions.allows([.camera], origin: "https://meet.google.com"))
    #expect(permissions.allows([.microphone], origin: "https://meet.google.com"))
    permissions.revoke(.microphone, origin: "https://meet.google.com")
    #expect(permissions.grants.isEmpty)
    #expect(SitePermissions(defaults: defaults).grants.isEmpty)
  }

  @Test func revokeAllAndRemoveAll() {
    let permissions = SitePermissions(defaults: freshDefaults())
    permissions.allow([.location], origin: "https://maps.apple.com", host: "maps.apple.com")
    permissions.allow([.camera], origin: "https://meet.google.com", host: "meet.google.com")
    permissions.revokeAll(origin: "https://maps.apple.com")
    #expect(permissions.grants.map(\.host) == ["meet.google.com"])
    permissions.removeAll()
    #expect(permissions.grants.isEmpty)
  }

  @Test func emptyGrantsAreIgnored() {
    let permissions = SitePermissions(defaults: freshDefaults())
    permissions.allow([], origin: "https://example.com", host: "example.com")
    #expect(permissions.grants.isEmpty)
    #expect(!permissions.allows([], origin: "https://example.com"))
  }
}
