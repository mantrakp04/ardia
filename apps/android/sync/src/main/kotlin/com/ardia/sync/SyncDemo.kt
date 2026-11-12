package com.ardia.sync

object SyncDemo {
    const val DEVICE_NAME = SyncMeta.DEFAULT_DEVICE_NAME
    const val FOLDER_NAME = "Ardia Sync"

    fun snapshot(now: Long = System.currentTimeMillis()): SyncSnapshot {
        val mac = SyncedDevice("demo-mac", "MacBook Pro", SyncedDevice.MAC, (now - 40_000).toDouble(), isCurrent = false, canReceiveTabs = true)
        val studio = SyncedDevice("demo-studio", "Mac Studio", SyncedDevice.MAC, (now - 3 * 3_600_000L).toDouble(), isCurrent = false, canReceiveTabs = false)
        val phone = SyncedDevice("demo-phone", DEVICE_NAME, SyncedDevice.PHONE, now.toDouble(), isCurrent = true, canReceiveTabs = true)
        val macTabs = listOf(
            RemoteTab("https://developer.apple.com/documentation/swiftui", "SwiftUI | Apple Developer Documentation"),
            RemoteTab("https://www.swift.org/blog/", "Blog | Swift.org"),
            RemoteTab("https://news.ycombinator.com/", "Hacker News"),
            RemoteTab("https://en.wikipedia.org/wiki/Lisbon", "Lisbon - Wikipedia"),
            RemoteTab("https://www.nytimes.com/section/technology", "Technology - The New York Times"),
            RemoteTab("https://github.com/swiftlang/swift", "swiftlang/swift: The Swift Programming Language"),
            RemoteTab("https://www.figma.com/community", "Figma Community"),
            RemoteTab("https://www.theverge.com/", "The Verge"),
            RemoteTab("https://www.youtube.com/@WWDC", "WWDC - YouTube"),
            RemoteTab("https://www.allrecipes.com/recipe/21014/good-old-fashioned-pancakes/", "Good Old-Fashioned Pancakes"),
            RemoteTab("https://maps.apple.com/?q=Coffee", "Coffee - Apple Maps"),
            RemoteTab("https://www.bbc.com/weather", "BBC Weather"),
        )
        val studioTabs = listOf(
            RemoteTab("https://www.apple.com/final-cut-pro/", "Final Cut Pro - Apple"),
            RemoteTab("https://www.dpreview.com/", "Digital Photography Review"),
        )
        val pinned = PinnedArea(
            tiles = listOf(
                PinnedTile("demo-mail", "Mail", "https://www.icloud.com/mail"),
                PinnedTile("demo-calendar", "Calendar", "https://www.icloud.com/calendar"),
                PinnedTile(
                    "tilefold:demo-social",
                    "Social",
                    "https://mastodon.social/",
                    folder = listOf(
                        PinnedTab("demo-mastodon", "Mastodon", "https://mastodon.social/"),
                        PinnedTab("demo-reddit", "Reddit", "https://www.reddit.com/"),
                    ),
                ),
                PinnedTile("demo-music", "Music", "https://music.apple.com/"),
            ),
            sections = listOf(
                PinnedSection(tab = PinnedTab("demo-notes", "Notes", "https://www.icloud.com/notes", "note.text")),
                PinnedSection(
                    group = PinnedGroup(
                        "demo-trip",
                        "Lisbon Trip",
                        "airplane",
                        "orange",
                        listOf(
                            PinnedSection(tab = PinnedTab("demo-flights", "Flights", "https://www.tap.pt/")),
                            PinnedSection(tab = PinnedTab("demo-hotel", "Hotel", "https://www.booking.com/")),
                            PinnedSection(
                                group = PinnedGroup(
                                    "demo-food",
                                    "Food",
                                    null,
                                    "red",
                                    listOf(PinnedSection(tab = PinnedTab("demo-pasteis", "Pastéis de Belém", "https://pasteisdebelem.pt/"))),
                                ),
                            ),
                        ),
                    ),
                ),
                PinnedSection(tab = PinnedTab("demo-docs", "Project Docs", "https://www.notion.so/")),
            ),
        )
        val added = (now - 30 * 86_400_000L).toDouble()
        val bookmarks = listOf(
            BookmarkItem("demo-bm-apple", "Apple", "https://www.apple.com/", added, BookmarkItem.BAR),
            BookmarkItem(
                "demo-bm-reading",
                "Reading",
                null,
                added,
                BookmarkItem.BAR,
                listOf(
                    BookmarkItem("demo-bm-swift", "The Swift Programming Language", "https://docs.swift.org/swift-book/", added),
                    BookmarkItem("demo-bm-hig", "Human Interface Guidelines", "https://developer.apple.com/design/human-interface-guidelines/", added),
                ),
            ),
            BookmarkItem("demo-bm-weather", "Weather", "https://weather.com/", added, BookmarkItem.OTHER),
        )
        val history = listOf(
            HistoryItem("https://developer.apple.com/documentation/swiftui", "SwiftUI | Apple Developer Documentation", 14, (now - 300_000L).toDouble()),
            HistoryItem("https://en.wikipedia.org/wiki/Lisbon", "Lisbon - Wikipedia", 3, (now - 3_600_000L).toDouble()),
            HistoryItem("https://news.ycombinator.com/", "Hacker News", 41, (now - 7_200_000L).toDouble()),
            HistoryItem("https://www.swift.org/blog/", "Blog | Swift.org", 5, (now - 86_400_000L).toDouble()),
            HistoryItem("https://www.bbc.com/weather", "BBC Weather", 9, (now - 2 * 86_400_000L).toDouble()),
        )
        val personal = SyncedProfile(
            syncId = "demo-personal",
            name = "Personal",
            color = "plum",
            icon = null,
            isDefault = true,
            theme = null,
            deviceTabs = listOf(
                DeviceTabs(mac.id, mac.name, SyncedDevice.MAC, macTabs),
                DeviceTabs(studio.id, studio.name, SyncedDevice.MAC, studioTabs),
            ),
            pinned = pinned,
            bookmarks = bookmarks,
            history = history,
            sendTargets = listOf(mac.id),
        )
        val work = SyncedProfile(
            syncId = "demo-work",
            name = "Work",
            color = "green",
            icon = "briefcase",
            isDefault = false,
            theme = SyncedTheme(listOf("#4F7CFF", "#9B6BFF"), listOf("#1E2A5A", "#3A2466")),
            deviceTabs = listOf(
                DeviceTabs(mac.id, mac.name, SyncedDevice.MAC, listOf(RemoteTab("https://linear.app/", "Linear"), RemoteTab("https://www.notion.so/", "Notion"))),
            ),
            pinned = PinnedArea(tiles = listOf(PinnedTile("demo-work-mail", "Mail", "https://outlook.office.com/"))),
            bookmarks = emptyList(),
            history = emptyList(),
            sendTargets = listOf(mac.id),
        )
        return SyncSnapshot(
            devices = listOf(phone, mac, studio),
            profiles = listOf(personal, work),
            search = SyncedSearch("google"),
            syncedAt = now,
        )
    }
}

class DemoSyncDevice(now: Long = System.currentTimeMillis()) : SyncDevice {
    override val isDemo: Boolean get() = true
    override val phase: SyncPhase get() = SyncPhase.Updated
    override val snapshot: SyncSnapshot = SyncDemo.snapshot(now)
    override val pendingDownloads: Int get() = 0
    override val lastSynced: Long? = now
    override val isEnabled: Boolean get() = true
    override val isRunning: Boolean get() = true
    override val folderName: String get() = SyncDemo.FOLDER_NAME
    override val hasUnsentChanges: Boolean get() = false
    override val wantsBackgroundRefresh: Boolean get() = false
    override var deviceName: String = SyncDemo.DEVICE_NAME
    override var selectedProfileId: String? = null
    override var source: LocalBrowsingSource? = null

    override fun start() {}

    override fun becameActive() {}

    override fun resignedActive() {}

    override fun syncNow() {}

    override fun backgroundCycle(): Boolean = true

    override fun localDidChange() {}

    override fun cancelCoordination() {}

    override fun connect(phrase: String, pick: SyncFolderPick): ConnectResult = ConnectResult.Connected

    override fun changeFolder(pick: SyncFolderPick): ConnectResult = ConnectResult.Connected

    override fun stopSyncing() {}

    override fun acknowledgeReset() {}

    override fun send(url: String, title: String, to: SyncedDevice, profileSyncId: String?, key: String, fromPrivateTab: Boolean): Boolean = !fromPrivateTab

    override fun addBookmark(url: String, title: String, profileSyncId: String?, fromPrivateTab: Boolean): Boolean = !fromPrivateTab

    override fun takeReceived(): List<ReceivedTab> = emptyList()

    override fun close() {}
}
