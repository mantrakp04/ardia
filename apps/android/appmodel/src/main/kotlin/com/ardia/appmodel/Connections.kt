package com.ardia.appmodel

import com.ardia.blocking.ContentBlocker
import com.ardia.browser.NightShadeMode as PageNightShade
import com.ardia.browser.PageFilter
import com.ardia.browser.SitePreferences
import com.ardia.browser.VisitKind
import com.ardia.store.AppLinkPreference
import com.ardia.store.BrowsingPreferences
import com.ardia.store.CandidateBookmark
import com.ardia.store.CustomSearchEngine
import com.ardia.store.HistoryRow
import com.ardia.store.IncomingTab
import com.ardia.store.NightShadeMode
import com.ardia.store.SearchChoice
import com.ardia.store.SyncBrowsingSource
import com.ardia.store.SyncedBrowsing
import com.ardia.store.VisitTransition
import com.ardia.sync.BookmarkItem
import com.ardia.sync.LocalBrowsingSource
import com.ardia.sync.LocalTabRecord
import com.ardia.sync.LocalVisitRecord
import com.ardia.sync.ReceivedTab
import com.ardia.sync.SyncSnapshot
import com.ardia.sync.SyncedDevice
import com.ardia.sync.SyncedSearch

class StoreSitePreferences(private val preferences: BrowsingPreferences) : SitePreferences {
    override fun nightShade(host: String?, isPrivate: Boolean): PageNightShade = pageMode(preferences.current.nightShade(host, isPrivate))

    override fun pageZoom(host: String?, isPrivate: Boolean): Double? = preferences.current.site(host, isPrivate).pageZoom

    override fun setPageZoom(host: String, isPrivate: Boolean, zoom: Double?) {
        preferences.updateSite(host, isPrivate) { it.copy(pageZoom = zoom?.takeIf { value -> value != 1.0 }) }
    }

    override fun opensLinksInApps(host: String?, isPrivate: Boolean): Boolean = preferences.current.appLinks(host, isPrivate) == AppLinkPreference.APP

    companion object {
        fun pageMode(mode: NightShadeMode): PageNightShade = when (mode) {
            NightShadeMode.DISABLED -> PageNightShade.Disabled
            NightShadeMode.AUTOMATIC -> PageNightShade.Automatic
            NightShadeMode.ALWAYS -> PageNightShade.Always
        }
    }
}

class BlockingPageFilter(private val isPrivate: Boolean, private val blocker: () -> ContentBlocker?) : PageFilter {
    private var madeFor: ContentBlocker? = null
    private var made: com.ardia.blocking.PageFilter? = null

    private fun filter(): com.ardia.blocking.PageFilter? {
        val current = blocker() ?: return null
        synchronized(this) {
            if (madeFor !== current) {
                made = current.pageFilter(isPrivate)
                madeFor = current
            }
            return made
        }
    }

    override fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean): Boolean =
        filter()?.blocks(requestUrl, pageUrl, isMainFrame) ?: false

    override fun scriptsAtDocumentStart(pageUrl: String): List<String> = filter()?.scriptsAtDocumentStart(pageUrl).orEmpty()

    override fun scriptsAtDocumentEnd(pageUrl: String): List<String> = filter()?.scriptsAtDocumentEnd(pageUrl).orEmpty()
}

class StoreSyncSource(private val source: SyncBrowsingSource) : LocalBrowsingSource {
    override fun syncedTabs(): List<LocalTabRecord> = source.syncedTabs().map { LocalTabRecord(it.url, it.title, it.lastActive, it.profileSyncId) }

    override fun syncedVisits(since: Long): List<LocalVisitRecord> = source.syncedVisits(since).map(::record)

    override fun syncedVisits(urls: Set<String>): List<LocalVisitRecord> = source.syncedVisits(urls).map(::record)

    override fun removeVisits(urls: Set<String>, profileSyncId: String?) = source.removeVisits(urls, profileSyncId)

    override fun receive(tabs: List<ReceivedTab>): Boolean = source.receive(tabs.map(::incoming))

    private fun record(visit: com.ardia.store.VisitRecord) = LocalVisitRecord(visit.url, visit.title, visit.visitedAt, visit.profileSyncId)

    companion object {
        fun incoming(tab: ReceivedTab) = IncomingTab(tab.key, tab.url, tab.title, tab.fromDevice, tab.sentAt, tab.profileSyncId, tab.fromDeviceId)
    }
}

object SyncedData {
    fun searchChoice(search: SyncedSearch?): SearchChoice? = search?.let { synced ->
        SearchChoice(
            engineId = synced.engineId,
            customUrl = synced.customURL,
            customEngines = synced.customEngines.map { CustomSearchEngine(it.id, it.name, it.keyword, it.url) },
        )
    }

    fun browsing(snapshot: SyncSnapshot, profileSyncId: String?): SyncedBrowsing? {
        val profile = snapshot.profile(profileSyncId) ?: return null
        val currentDevices = snapshot.devices.filter { it.isCurrent }.map { it.id }.toSet()
        val bookmarks = ArrayList<CandidateBookmark>()
        fun walk(items: List<BookmarkItem>) {
            for (item in items) {
                item.url?.let { bookmarks.add(CandidateBookmark(it, item.title)) }
                item.children?.let(::walk)
            }
        }
        walk(profile.bookmarks)
        for (tile in profile.pinned.tiles) {
            bookmarks.add(CandidateBookmark(tile.url, tile.title, tile.icon))
            tile.folder.orEmpty().forEach { bookmarks.add(CandidateBookmark(it.url, it.title, it.icon)) }
        }
        return SyncedBrowsing(
            history = profile.history.map { HistoryRow(it.url, it.title, null, it.visits, it.lastVisit) },
            deviceTabs = profile.deviceTabs.map { device ->
                SyncedBrowsing.DeviceTabs(
                    deviceId = device.deviceId,
                    deviceName = device.deviceName,
                    isMac = device.kind == SyncedDevice.MAC,
                    isCurrent = device.deviceId in currentDevices,
                    tabs = device.tabs.map { SyncedBrowsing.RemoteTab(it.url, it.title) },
                )
            },
            bookmarks = bookmarks,
            syncedAt = snapshot.syncedAt,
        )
    }
}

object VisitKinds {
    fun transition(kind: VisitKind): VisitTransition? = when (kind) {
        VisitKind.Typed -> VisitTransition.TYPED
        VisitKind.Link, VisitKind.SameDocument -> VisitTransition.LINK
        VisitKind.BackForward -> VisitTransition.BACK_FORWARD
        VisitKind.Redirect -> VisitTransition.OTHER
        VisitKind.Restored -> null
    }
}
