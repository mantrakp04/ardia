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

  @Test func grantsAreSavedPerSiteNextToItsZoom() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.update("meet.example") { $0.pageZoom = 1.25 }
    preferences.grant([.camera, .microphone], host: "WWW.Meet.example")
    let relaunched = BrowsingPreferences(defaults: defaults)
    #expect(relaunched.isGranted([.camera], host: "meet.example"))
    #expect(relaunched.isGranted([.camera, .microphone], host: "www.meet.example"))
    #expect(!relaunched.isGranted([.location], host: "meet.example"))
    #expect(!relaunched.isGranted([.camera], host: "other.example"))
    #expect(relaunched.settings(for: "meet.example").pageZoom == 1.25)
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

  @Test func revokingTheLastPermissionForgetsTheSiteUnlessItHasOtherSettings() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.grant([.location], host: "maps.example")
    preferences.grant([.camera], host: "zoomed.example")
    preferences.update("zoomed.example") { $0.pageZoom = 1.5 }
    preferences.revoke(Set(SitePermission.allCases), host: "maps.example")
    preferences.revoke([.camera], host: "zoomed.example")
    #expect(Set(BrowsingPreferences(defaults: defaults).sites.keys) == ["zoomed.example"])
    #expect(preferences.permissionGrants.isEmpty)
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

  @Test func settingsSavedBeforePermissionsExistedStillLoad() throws {
    defer { cleanUp() }
    defaults.set(Data(#"{"zoomed.example":{"pageZoom":1.25,"nightShade":"always"}}"#.utf8), forKey: "browsing.sites")
    let preferences = BrowsingPreferences(defaults: defaults)
    #expect(preferences.settings(for: "zoomed.example").pageZoom == 1.25)
    #expect(preferences.settings(for: "zoomed.example").permissions == nil)
    #expect(preferences.permissionGrants.isEmpty)
  }

  @Test func aFullSiteListDropsSitesWithoutPermissionsFirst() {
    defer { cleanUp() }
    let preferences = BrowsingPreferences(defaults: defaults)
    preferences.grant([.camera], host: "keep.example")
    for index in 0...BrowsingPreferences.siteLimit {
      preferences.update("zoom\(index).example") { $0.pageZoom = 1.25 }
    }
    #expect(preferences.sites.count == BrowsingPreferences.siteLimit)
    #expect(preferences.isGranted([.camera], host: "keep.example"))
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
    ("WWW.Meet.Example", 0, "meet.example"),
    ("meet.example", 443, "meet.example:443"),
    ("localhost", 8443, "localhost:8443"),
  ])
  func grantsAreKeyedByHostAndPort(host: String, port: Int, expected: String) {
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
}
