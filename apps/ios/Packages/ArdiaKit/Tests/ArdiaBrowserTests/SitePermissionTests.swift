import Foundation
import Testing
@testable import ArdiaBrowser

@MainActor
@Suite struct SitePermissionTests {
  let suite = "ardia.tests.\(UUID().uuidString)"
  let defaults: UserDefaults

  init() throws {
    defaults = try #require(UserDefaults(suiteName: suite))
  }

  func cleanUp() {
    defaults.removePersistentDomain(forName: suite)
  }

  @Test func grantsAreSavedPerSiteAndSurviveARelaunch() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.grant([.camera, .microphone], host: "meet.example")
    let relaunched = BrowsingPreferences(defaults: defaults)
    #expect(relaunched.isGranted([.camera], host: "meet.example"))
    #expect(relaunched.isGranted([.camera, .microphone], host: "MEET.example."))
    #expect(!relaunched.isGranted([.location], host: "meet.example"))
    #expect(!relaunched.isGranted([.camera], host: "other.example"))
  }

  @Test func aGrantOnWwwIsNotAGrantOnTheBareHost() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.update("www.example.com") { $0.pageZoom = 1.25 }
    preferences.grant([.camera], host: SitePermissionSite.key(host: "www.example.com", port: 0))
    #expect(preferences.isGranted([.camera], host: "www.example.com"))
    #expect(!preferences.isGranted([.camera], host: "example.com"))
    #expect(preferences.settings(for: "example.com").pageZoom == 1.25)
    preferences.grant([.camera], host: "example.com")
    preferences.revoke([.camera], host: "www.example.com")
    let relaunched = BrowsingPreferences(defaults: defaults)
    #expect(!relaunched.isGranted([.camera], host: "www.example.com"))
    #expect(relaunched.isGranted([.camera], host: "example.com"))
    #expect(relaunched.permissionGrants.map(\.host) == ["example.com"])
  }

  @Test func revokingOnePermissionKeepsTheRest() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.grant([.camera, .microphone], host: "meet.example")
    preferences.revoke([.camera], host: "meet.example")
    let relaunched = BrowsingPreferences(defaults: defaults)
    #expect(!relaunched.isGranted([.camera], host: "meet.example"))
    #expect(relaunched.isGranted([.microphone], host: "meet.example"))
  }

  @Test func revokingTheLastPermissionForgetsTheSiteButNotItsZoom() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.grant([.location], host: "maps.example")
    preferences.update("maps.example") { $0.pageZoom = 1.5 }
    preferences.revoke(Set(SitePermission.allCases), host: "maps.example")
    let relaunched = BrowsingPreferences(defaults: defaults)
    #expect(relaunched.permissionGrants.isEmpty)
    #expect(relaunched.settings(for: "maps.example").pageZoom == 1.5)
  }

  @Test func theListShowsEachSiteOnceInAlphabeticalOrder() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.grant([.location], host: "maps.example")
    preferences.grant([.microphone], host: "b.example")
    preferences.grant([.camera], host: "b.example")
    preferences.update("zoom-only.example") { $0.pageZoom = 2 }
    #expect(preferences.permissionGrants == [
      SitePermissionGrant(host: "b.example", permissions: [.camera, .microphone]),
      SitePermissionGrant(host: "maps.example", permissions: [.location]),
    ])
  }

  @Test func grantsSavedInsideSiteSettingsByAnEarlierBuildAreNotHonoured() throws {
    defer { cleanUp() }
    defaults.set(Data(#"{"example.com":{"pageZoom":1.25,"permissions":["camera"]}}"#.utf8), forKey: "browsing.sites")
    let preferences = BrowsingPreferences(defaults: defaults)
    #expect(preferences.settings(for: "www.example.com").pageZoom == 1.25)
    #expect(!preferences.isGranted([.camera], host: "example.com"))
    #expect(!preferences.isGranted([.camera], host: "www.example.com"))
    #expect(preferences.permissionGrants.isEmpty)
    let stored = try #require(defaults.data(forKey: "browsing.sites"))
    #expect(!String(decoding: stored, as: UTF8.self).contains("permissions"))
    #expect(BrowsingPreferences(defaults: defaults).settings(for: "example.com").pageZoom == 1.25)
  }

  @Test(arguments: [
    ("https", false, SitePermissionMemory.saved),
    ("http", false, SitePermissionMemory.session),
    ("file", false, SitePermissionMemory.session),
    ("https", true, SitePermissionMemory.privateSession),
    ("http", true, SitePermissionMemory.privateSession),
  ])
  func onlySecurePublicPagesSaveAGrant(scheme: String, isPrivate: Bool, expected: SitePermissionMemory) {
    #expect(SitePermissionMemory(scheme: scheme, isPrivate: isPrivate) == expected)
  }

  @Test func captureRequestsMapToPermissions() {
    #expect(SitePermission.permissions(for: .camera) == [.camera])
    #expect(SitePermission.permissions(for: .microphone) == [.microphone])
    #expect(SitePermission.permissions(for: .cameraAndMicrophone) == [.camera, .microphone])
  }

  @Test(arguments: [
    ("meet.example", 0, "meet.example"),
    ("WWW.Meet.Example", 0, "www.meet.example"),
    ("www.example.com.", 0, "www.example.com"),
    (" Example.com ", 0, "example.com"),
    ("meet.example", 443, "meet.example:443"),
    ("localhost", 8443, "localhost:8443"),
  ])
  func grantsAreKeyedByTheFullHostAndPort(host: String, port: Int, expected: String) {
    #expect(SitePermissionSite.key(host: host, port: port) == expected)
  }

  @Test func aGrantOnOnePortDoesNotOpenAnother() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.grant([.camera], host: SitePermissionSite.key(host: "localhost", port: 8443))
    #expect(preferences.isGranted([.camera], host: "localhost:8443"))
    #expect(!preferences.isGranted([.camera], host: "localhost"))
    #expect(!preferences.isGranted([.camera], host: "localhost:3000"))
    #expect(preferences.permissionGrants.map(\.host) == ["localhost:8443"])
  }

  @Test func revokingFindsEveryTabThatUsedTheGrantUntilItLoadsAnotherPage() {
    let call = UUID()
    let embed = UUID()
    let other = UUID()
    let use = SitePermissionUse()
      .recording([.camera, .microphone], site: "meet.example", tab: call)
      .recording([.microphone], site: "meet.example", tab: embed)
      .recording([.location], site: "maps.example", tab: other)
    #expect(use.tabs(using: [.camera], site: "meet.example") == [call])
    #expect(use.tabs(using: [.microphone], site: "meet.example") == [call, embed])
    #expect(use.tabs(using: [.camera, .microphone], site: "meet.example") == [call, embed])
    #expect(use.tabs(using: [.camera], site: "maps.example").isEmpty)
    #expect(use.forgetting(tab: call).tabs(using: [.camera, .microphone], site: "meet.example") == [embed])
  }

  @Test func usageOnWwwIsNotUsageOnTheBareHost() {
    let tab = UUID()
    let use = SitePermissionUse().recording([.camera], site: "www.example.com", tab: tab)
    #expect(use.tabs(using: [.camera], site: "www.example.com") == [tab])
    #expect(use.tabs(using: [.camera], site: "example.com").isEmpty)
  }
}
