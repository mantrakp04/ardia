import Foundation

extension SyncSnapshot {
  public static let demo: SyncSnapshot = {
    let now = Date.now
    let mac = SyncedDevice(id: "demo-mac", name: "MacBook Pro", kind: .mac, lastSeen: now.addingTimeInterval(-40), isCurrent: false, canReceiveTabs: true)
    let studio = SyncedDevice(id: "demo-studio", name: "Mac Studio", kind: .mac, lastSeen: now.addingTimeInterval(-3 * 3600), isCurrent: false, canReceiveTabs: false)
    let phone = SyncedDevice(id: "demo-phone", name: "iPhone", kind: .phone, lastSeen: now, isCurrent: true, canReceiveTabs: true)
    let macTabs: [RemoteTab] = [
      .init(url: "https://developer.apple.com/documentation/swiftui", title: "SwiftUI | Apple Developer Documentation"),
      .init(url: "https://www.swift.org/blog/", title: "Blog | Swift.org"),
      .init(url: "https://news.ycombinator.com/", title: "Hacker News"),
      .init(url: "https://en.wikipedia.org/wiki/Lisbon", title: "Lisbon - Wikipedia"),
      .init(url: "https://www.nytimes.com/section/technology", title: "Technology - The New York Times"),
      .init(url: "https://github.com/swiftlang/swift", title: "swiftlang/swift: The Swift Programming Language"),
      .init(url: "https://www.figma.com/community", title: "Figma Community"),
      .init(url: "https://www.theverge.com/", title: "The Verge"),
      .init(url: "https://www.youtube.com/@WWDC", title: "WWDC - YouTube"),
      .init(url: "https://www.allrecipes.com/recipe/21014/good-old-fashioned-pancakes/", title: "Good Old-Fashioned Pancakes"),
      .init(url: "https://maps.apple.com/?q=Coffee", title: "Coffee - Apple Maps"),
      .init(url: "https://www.bbc.com/weather", title: "BBC Weather"),
    ]
    let studioTabs: [RemoteTab] = [
      .init(url: "https://www.apple.com/final-cut-pro/", title: "Final Cut Pro - Apple"),
      .init(url: "https://www.dpreview.com/", title: "Digital Photography Review"),
    ]
    let pinned = PinnedArea(
      tiles: [
        PinnedTile(key: "demo-mail", title: "Mail", url: "https://www.icloud.com/mail", icon: nil, folder: nil),
        PinnedTile(key: "demo-calendar", title: "Calendar", url: "https://www.icloud.com/calendar", icon: nil, folder: nil),
        PinnedTile(key: "tilefold:demo-social", title: "Social", url: "https://mastodon.social/", icon: nil, folder: [
          PinnedTab(key: "demo-mastodon", title: "Mastodon", url: "https://mastodon.social/", icon: nil),
          PinnedTab(key: "demo-reddit", title: "Reddit", url: "https://www.reddit.com/", icon: nil),
        ]),
        PinnedTile(key: "demo-music", title: "Music", url: "https://music.apple.com/", icon: nil, folder: nil),
      ],
      sections: [
        .tab(PinnedTab(key: "demo-notes", title: "Notes", url: "https://www.icloud.com/notes", icon: "note.text")),
        .group(PinnedGroup(key: "demo-trip", name: "Lisbon Trip", icon: "airplane", color: "orange", items: [
          .tab(PinnedTab(key: "demo-flights", title: "Flights", url: "https://www.tap.pt/", icon: nil)),
          .tab(PinnedTab(key: "demo-hotel", title: "Hotel", url: "https://www.booking.com/", icon: nil)),
          .group(PinnedGroup(key: "demo-food", name: "Food", icon: nil, color: "red", items: [
            .tab(PinnedTab(key: "demo-pasteis", title: "Pastéis de Belém", url: "https://pasteisdebelem.pt/", icon: nil)),
          ])),
        ])),
        .tab(PinnedTab(key: "demo-docs", title: "Project Docs", url: "https://www.notion.so/", icon: nil)),
      ]
    )
    let added = now.addingTimeInterval(-30 * 86_400)
    let bookmarks: [BookmarkItem] = [
      BookmarkItem(key: "demo-bm-apple", title: "Apple", url: "https://www.apple.com/", added: added, root: .bar, children: nil),
      BookmarkItem(key: "demo-bm-reading", title: "Reading", url: nil, added: added, root: .bar, children: [
        BookmarkItem(key: "demo-bm-swift", title: "The Swift Programming Language", url: "https://docs.swift.org/swift-book/", added: added, root: nil, children: nil),
        BookmarkItem(key: "demo-bm-hig", title: "Human Interface Guidelines", url: "https://developer.apple.com/design/human-interface-guidelines/", added: added, root: nil, children: nil),
      ]),
      BookmarkItem(key: "demo-bm-weather", title: "Weather", url: "https://weather.com/", added: added, root: .other, children: nil),
    ]
    let history: [HistoryItem] = [
      HistoryItem(url: "https://developer.apple.com/documentation/swiftui", title: "SwiftUI | Apple Developer Documentation", visits: 14, lastVisit: now.addingTimeInterval(-300)),
      HistoryItem(url: "https://en.wikipedia.org/wiki/Lisbon", title: "Lisbon - Wikipedia", visits: 3, lastVisit: now.addingTimeInterval(-3_600)),
      HistoryItem(url: "https://news.ycombinator.com/", title: "Hacker News", visits: 41, lastVisit: now.addingTimeInterval(-7_200)),
      HistoryItem(url: "https://www.swift.org/blog/", title: "Blog | Swift.org", visits: 5, lastVisit: now.addingTimeInterval(-86_400)),
      HistoryItem(url: "https://www.bbc.com/weather", title: "BBC Weather", visits: 9, lastVisit: now.addingTimeInterval(-2 * 86_400)),
    ]
    let personal = SyncedProfile(
      syncId: "demo-personal",
      name: "Personal",
      color: "blue",
      icon: nil,
      isDefault: true,
      theme: nil,
      deviceTabs: [
        DeviceTabs(deviceId: mac.id, deviceName: mac.name, kind: .mac, tabs: macTabs),
        DeviceTabs(deviceId: studio.id, deviceName: studio.name, kind: .mac, tabs: studioTabs),
      ],
      pinned: pinned,
      bookmarks: bookmarks,
      history: history,
      sendTargets: [mac.id]
    )
    let work = SyncedProfile(
      syncId: "demo-work",
      name: "Work",
      color: "green",
      icon: "briefcase",
      isDefault: false,
      theme: SyncedTheme(colors: ["#4F7CFF", "#9B6BFF"], darkColors: ["#1E2A5A", "#3A2466"]),
      deviceTabs: [DeviceTabs(deviceId: mac.id, deviceName: mac.name, kind: .mac, tabs: [
        .init(url: "https://linear.app/", title: "Linear"),
        .init(url: "https://www.notion.so/", title: "Notion"),
      ])],
      pinned: PinnedArea(tiles: [PinnedTile(key: "demo-work-mail", title: "Mail", url: "https://outlook.office.com/", icon: nil, folder: nil)]),
      bookmarks: [],
      history: [],
      sendTargets: [mac.id]
    )
    return SyncSnapshot(
      devices: [phone, mac, studio],
      profiles: [personal, work],
      search: SyncedSearch(engineId: "google", customURL: nil, customEngines: []),
      syncedAt: now
    )
  }()
}
