package com.ardia.sync

import kotlinx.serialization.Serializable

@Serializable
data class SyncSnapshot(
    val devices: List<SyncedDevice> = emptyList(),
    val profiles: List<SyncedProfile> = emptyList(),
    val search: SyncedSearch? = null,
    val syncedAt: Long? = null,
) {
    val defaultProfile: SyncedProfile? get() = profiles.firstOrNull { it.isDefault } ?: profiles.firstOrNull()

    fun profile(syncId: String?): SyncedProfile? = syncId?.let { id -> profiles.firstOrNull { it.syncId == id } } ?: defaultProfile

    fun sameAs(other: SyncSnapshot): Boolean = copy(syncedAt = other.syncedAt) == other

    companion object {
        val empty = SyncSnapshot()
    }
}

@Serializable
data class SyncedDevice(
    val id: String,
    val name: String,
    val kind: String,
    val lastSeen: Double? = null,
    val isCurrent: Boolean,
    val canReceiveTabs: Boolean,
)

@Serializable
data class SyncedProfile(
    val syncId: String,
    val name: String,
    val color: String? = null,
    val icon: String? = null,
    val isDefault: Boolean,
    val theme: SyncedTheme? = null,
    val deviceTabs: List<DeviceTabs> = emptyList(),
    val pinned: PinnedArea = PinnedArea(),
    val bookmarks: List<BookmarkItem> = emptyList(),
    val history: List<HistoryItem> = emptyList(),
    val sendTargets: List<String>? = null,
)

@Serializable
data class SyncedTheme(val colors: List<String>, val darkColors: List<String>? = null)

@Serializable
data class DeviceTabs(val deviceId: String, val deviceName: String, val kind: String, val tabs: List<RemoteTab>)

@Serializable
data class RemoteTab(val url: String, val title: String)

@Serializable
data class PinnedArea(val tiles: List<PinnedTile> = emptyList(), val sections: List<PinnedSection> = emptyList())

@Serializable
data class PinnedTile(val key: String, val title: String, val url: String, val icon: String? = null, val folder: List<PinnedTab>? = null)

@Serializable
data class PinnedTab(val key: String, val title: String, val url: String, val icon: String? = null)

@Serializable
data class PinnedSection(val tab: PinnedTab? = null, val group: PinnedGroup? = null) {
    val id: String get() = tab?.let { "t:${it.key}" } ?: "g:${group?.key}"
}

@Serializable
data class PinnedGroup(val key: String, val name: String, val icon: String? = null, val color: String? = null, val items: List<PinnedSection> = emptyList())

@Serializable
data class BookmarkItem(
    val key: String,
    val title: String,
    val url: String? = null,
    val added: Double,
    val root: String? = null,
    val children: List<BookmarkItem>? = null,
) {
    val isFolder: Boolean get() = url == null
}

@Serializable
data class HistoryItem(val url: String, val title: String, val visits: Int, val lastVisit: Double)

@Serializable
data class SyncedSearch(val engineId: String, val customURL: String? = null, val customEngines: List<CustomEngine> = emptyList()) {
    @Serializable
    data class CustomEngine(val id: String, val name: String, val keyword: String, val url: String)
}

data class ReceivedTab(
    val key: String,
    val url: String,
    val title: String,
    val fromDevice: String,
    val sentAt: Long,
    val profileSyncId: String,
    val fromDeviceId: String,
)

data class LocalTabRecord(val url: String, val title: String, val lastActive: Long, val profileSyncId: String?)

data class LocalVisitRecord(val url: String, val title: String, val visitedAt: List<Long>, val profileSyncId: String?)

data class HistoryRemoval(val profileSyncId: String?, val urls: Set<String>, val includesUnassigned: Boolean = false)

sealed interface SyncPhase {
    data object Off : SyncPhase
    data object Starting : SyncPhase
    data object Updated : SyncPhase
    data class Stalled(val message: String) : SyncPhase
    data object Offline : SyncPhase
    data object Locked : SyncPhase
    data object Reset : SyncPhase
}

interface LocalBrowsingSource {
    fun syncedTabs(): List<LocalTabRecord>

    fun syncedVisits(since: Long): List<LocalVisitRecord>

    fun syncedVisits(urls: Set<String>): List<LocalVisitRecord> = syncedVisits(0L).filter { it.url in urls }

    fun removeVisits(urls: Set<String>, profileSyncId: String?)

    fun receive(tabs: List<ReceivedTab>): Boolean
}
