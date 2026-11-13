import ArdiaSync
import Foundation
import SwiftData
import Testing
@testable import ArdiaBrowser

@MainActor
@Suite struct TabSpacesTests {
  static let personal = "personal"
  static let work = "work"
  static let travel = "travel"
  static let roster = SpaceRoster(ids: [personal, work, travel], defaultId: personal)

  func fixture(in space: String? = personal) throws -> StoreFixture {
    let fixture = try StoreFixture()
    fixture.store.updateSpaces(roster: Self.roster, current: space)
    return fixture
  }

  func urls(_ tabs: [BrowserTab]) -> [String] {
    tabs.map { URL(string: $0.url)?.host() ?? $0.url }
  }

  @Test func theDeckShowsOnlyTheCurrentSpacesTabs() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    fixture.open("https://a1.example")
    fixture.open("https://a2.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.open("https://b1.example")
    #expect(urls(fixture.store.openTabs) == ["b1.example"])
    #expect(fixture.store.allOpenTabs.count == 3)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(urls(fixture.store.openTabs) == ["a1.example", "a2.example"])
  }

  @Test func eachSpaceRemembersItsOwnSelectedTab() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let a1 = fixture.open("https://a1.example")
    fixture.open("https://a2.example")
    fixture.store.select(a1.id)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    let b1 = fixture.open("https://b1.example")
    fixture.open("https://b2.example")
    fixture.store.select(b1.id)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(fixture.store.selectedTabID == a1.id)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    #expect(fixture.store.selectedTabID == b1.id)
  }

  @Test func theRememberedSelectionSurvivesARelaunch() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let a1 = fixture.open("https://a1.example")
    fixture.open("https://a2.example")
    fixture.store.select(a1.id)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.open("https://b1.example")
    let clock = fixture.clock
    let relaunched = TabStore(context: fixture.container.mainContext, defaults: fixture.defaults, now: { clock.now })
    relaunched.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(relaunched.selectedTabID == a1.id)
  }

  @Test func aSpaceWithNoTabsShowsTheStartScreen() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    fixture.open("https://a1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.travel)
    #expect(fixture.store.openTabs.isEmpty)
    #expect(fixture.store.selectedTabID == nil)
  }

  @Test func aSpaceWhoseRememberedTabClosedShowsItsMostRecentTab() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    fixture.open("https://a1.example")
    fixture.clock.advance(10)
    let a2 = fixture.open("https://a2.example")
    fixture.clock.advance(10)
    let a3 = fixture.open("https://a3.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(fixture.store.selectedTabID == a3.id)
    fixture.store.close(a3.id)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(fixture.store.selectedTabID == a2.id)
  }

  @Test func tabsWithNoSpaceOrAGoneSpaceShowUnderTheDefault() throws {
    let fixture = try fixture(in: nil)
    defer { fixture.cleanUp() }
    let loose = fixture.open("https://loose.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    let orphan = fixture.open("https://orphan.example")
    orphan.profileSyncId = "gone"
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(loose.profileSyncId == nil)
    #expect(Set(fixture.store.openTabs.map(\.id)) == [loose.id, orphan.id])
  }

  @Test func withSyncOffEveryTabIsInTheOneSpace() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    fixture.open("https://a1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.open("https://b1.example")
    fixture.store.updateSpaces(roster: .unnamed, current: nil)
    #expect(fixture.store.openTabs.count == 2)
  }

  @Test func closingTheSelectedTabPicksANeighbourInTheSameSpace() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let a1 = fixture.open("https://a1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.open("https://b1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    let a2 = fixture.open("https://a2.example")
    fixture.store.close(a2.id)
    #expect(fixture.store.selectedTabID == a1.id)
    fixture.store.close(a1.id)
    #expect(fixture.store.selectedTabID == nil)
  }

  @Test func closeAllClosesOnlyTheCurrentSpace() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    fixture.open("https://a1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.open("https://b1.example")
    fixture.store.closeAll()
    #expect(fixture.store.openTabs.isEmpty)
    #expect(urls(fixture.store.allOpenTabs) == ["a1.example"])
  }

  @Test func theArchiveAndReopenBelongToTheCurrentSpace() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let a1 = fixture.open("https://a1.example")
    fixture.store.close(a1.id)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    let b1 = fixture.open("https://b1.example")
    fixture.store.close(b1.id)
    fixture.store.loadArchive()
    #expect(fixture.store.archive.flatMap(\.tabs).map(\.id) == [b1.id])
    #expect(fixture.store.searchArchive("example").map(\.id) == [b1.id])
    #expect(fixture.store.searchArchive("example", inAllSpaces: true).count == 2)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(fixture.store.archive.flatMap(\.tabs).map(\.id) == [a1.id])
    #expect(fixture.store.canReopenClosed)
    #expect(fixture.store.reopenLastClosed().map(\.id) == [a1.id])
    #expect(!fixture.store.canReopenClosed)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    #expect(fixture.store.canReopenClosed)
  }

  @Test func movingToASpacePutsTheTabAtTheEndThereAndKeepsTheDeckHere() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let a1 = fixture.open("https://a1.example")
    let a2 = fixture.open("https://a2.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.open("https://b1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    fixture.store.moveToSpace(a2.id, space: Self.work)
    #expect(a2.profileSyncId == Self.work)
    #expect(fixture.store.openTabs.map(\.id) == [a1.id])
    #expect(fixture.store.selectedTabID == a1.id)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    #expect(urls(fixture.store.openTabs) == ["b1.example", "a2.example"])
  }

  @Test func privateTabsStayOutsideSpaces() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let secret = fixture.store.open(.url(URL(string: "https://secret.example")!), isPrivate: true)
    fixture.store.moveToSpace(secret.id, space: Self.work)
    #expect(secret.profileSyncId == nil)
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    #expect(fixture.store.privateTabs.map(\.id) == [secret.id])
    #expect(fixture.store.selectedTabID == secret.id)
  }

  @Test func newTabsGoToTheEndAndLinksRightAfterTheirOpener() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let a1 = fixture.open("https://a1.example")
    fixture.open("https://a2.example")
    fixture.store.open(.url(URL(string: "https://first.example")!, origin: .link), placement: .after(a1.id), selecting: false)
    fixture.store.open(.url(URL(string: "https://second.example")!, origin: .link), placement: .after(a1.id), selecting: false)
    #expect(urls(fixture.store.openTabs) == ["a1.example", "first.example", "second.example", "a2.example"])
    fixture.store.open(.url(URL(string: "https://front.example")!, origin: .link), placement: .after(a1.id), selecting: true)
    #expect(urls(fixture.store.openTabs) == ["a1.example", "front.example", "first.example", "second.example", "a2.example"])
    fixture.open("https://last.example")
    #expect(urls(fixture.store.openTabs).last == "last.example")
  }

  @Test func theOrderIsTheSameEverywhereAndMovingWorksWithinTheSpace() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let a1 = fixture.open("https://a1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.work)
    fixture.open("https://b1.example")
    fixture.store.updateSpaces(roster: Self.roster, current: Self.personal)
    fixture.open("https://a2.example")
    let a3 = fixture.open("https://a3.example")
    fixture.store.move(a3.id, to: 0)
    #expect(urls(fixture.store.openTabs) == ["a3.example", "a1.example", "a2.example"])
    fixture.store.move(a1.id, to: 2)
    #expect(urls(fixture.store.openTabs) == ["a3.example", "a2.example", "a1.example"])
    #expect(a1.profileSyncId == Self.personal)
    let clock = fixture.clock
    let relaunched = TabStore(context: fixture.container.mainContext, defaults: fixture.defaults, now: { clock.now })
    relaunched.updateSpaces(roster: Self.roster, current: Self.personal)
    #expect(urls(relaunched.openTabs) == ["a3.example", "a2.example", "a1.example"])
  }

  @Test func theDeckFilterMatchesTitleAndAddress() throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let news = fixture.open("https://news.example/today")
    fixture.store.update(news.id, title: "Morning Headlines")
    let mail = fixture.open("https://mail.example/inbox")
    fixture.store.update(mail.id, title: "Inbox")
    #expect(TabFilter.matching(fixture.store.openTabs, query: "").map(\.id) == [news.id, mail.id])
    #expect(TabFilter.matching(fixture.store.openTabs, query: "headl").map(\.id) == [news.id])
    #expect(TabFilter.matching(fixture.store.openTabs, query: "MAIL.ex").map(\.id) == [mail.id])
    #expect(TabFilter.matching(fixture.store.openTabs, query: "  inbox ").map(\.id) == [mail.id])
    #expect(TabFilter.matching(fixture.store.openTabs, query: "nothing").isEmpty)
  }
}
