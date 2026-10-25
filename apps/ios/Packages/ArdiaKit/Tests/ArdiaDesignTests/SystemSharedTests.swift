import Foundation
import Testing

@testable import ArdiaDesign

struct SystemLinkTests {
  @Test(arguments: [
    SystemLink.search(query: nil, browseForMe: false),
    .search(query: "pastéis de nata & coffee?", browseForMe: false),
    .search(query: "who are the beatles", browseForMe: true),
    .voiceSearch,
    .incognito,
    .open(URL(string: "https://en.wikipedia.org/wiki/Lisbon?a=1&b=2#History")!),
    .tab(UUID()),
    .macTabs,
    .inbox,
  ])
  func `every link survives a round trip through its URL`(link: SystemLink) {
    #expect(SystemLink(link.url) == link)
  }

  @Test(arguments: [
    "ardia://open?url=javascript:alert(1)",
    "ardia://open?url=file:///etc/passwd",
    "ardia://open",
    "ardia://tab/not-a-uuid",
    "ardia://browse/6F9619FF-8B86-D011-B42D-00C04FC964FF",
    "https://ardia.dev/search",
  ])
  func `links that aren't ours or open non-web pages are refused`(text: String) {
    #expect(SystemLink(URL(string: text)!) == nil)
  }

  @Test func `a blank query opens an empty search`() {
    #expect(SystemLink(URL(string: "ardia://search?q=%20%20")!) == .search(query: nil, browseForMe: false))
  }
}

struct SystemStoreTests {
  let directory = URL.temporaryDirectory.appending(path: "SystemStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)

  @Test func `the inbox hands each item over once, oldest first, and drops stale ones`() throws {
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = SystemStore(directory: directory)
    let now = Date.now
    let mac = SystemDevice(id: "mac", name: "MacBook Pro", kind: .mac)
    #expect(store.enqueue(SystemInboxItem(action: .send(to: mac), url: "https://b.example", title: "B", created: now.addingTimeInterval(-10))))
    #expect(store.enqueue(SystemInboxItem(action: .open, url: "https://a.example", title: "A", created: now.addingTimeInterval(-20))))
    #expect(store.enqueue(SystemInboxItem(action: .open, url: "https://old.example", title: "Old", created: now.addingTimeInterval(-SystemStore.inboxLifetime - 1))))

    let drained = store.drainInbox(now: now)
    #expect(drained.map(\.title) == ["A", "B"])
    #expect(drained.last?.action == .send(to: mac))
    #expect(store.drainInbox(now: now).isEmpty)
  }

  @Test func `saving a snapshot keeps only the favicons it still uses`() throws {
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = SystemStore(directory: directory)
    let kept = SystemStore.faviconName(forHost: "swift.org")
    let dropped = SystemStore.faviconName(forHost: "example.com")
    #expect(store.saveFavicon(Data([1]), named: kept))
    #expect(store.saveFavicon(Data([2]), named: dropped))
    let snapshot = SystemSnapshot(
      isSyncEnabled: true,
      macTabs: [SystemDeviceTabs(device: SystemDevice(id: "mac", name: "Mac", kind: .mac), tabs: [SystemTab(title: "Swift", url: "https://swift.org", favicon: kept)])],
      isBrowseForMeAvailable: true
    )

    #expect(store.save(snapshot))
    #expect(store.loadSnapshot() == snapshot)
    #expect(store.hasFavicon(named: kept))
    #expect(!store.hasFavicon(named: dropped))
  }

  @Test func `a missing or unreadable snapshot reads as empty`() throws {
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = SystemStore(directory: directory)
    #expect(store.loadSnapshot() == .empty)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data("{\"version\":99}".utf8).write(to: directory.appending(path: "snapshot.json"))
    #expect(store.loadSnapshot() == .empty)
  }
}
