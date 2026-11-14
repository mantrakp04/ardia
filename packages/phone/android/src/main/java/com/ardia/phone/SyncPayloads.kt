package com.ardia.phone

import com.ardia.sync.BookmarkItem
import com.ardia.sync.ConnectResult
import com.ardia.sync.PhraseCheck
import com.ardia.sync.PinnedSection
import com.ardia.sync.PinnedTab
import com.ardia.sync.ReceivedTab
import com.ardia.sync.SyncPhase
import com.ardia.sync.SyncSnapshot
import com.ardia.sync.SyncState
import com.ardia.sync.SyncStatusWords
import com.ardia.sync.SyncedDevice
import com.ardia.sync.SyncedProfile

object SyncPayloads {
    fun phase(phase: SyncPhase): String = when (phase) {
        SyncPhase.Off -> "off"
        SyncPhase.Starting -> "starting"
        SyncPhase.Updating -> "updating"
        SyncPhase.Updated -> "updated"
        is SyncPhase.Stalled -> "stalled"
        SyncPhase.Offline -> "offline"
        SyncPhase.NeedsFolderAccess -> "needsFolderAccess"
        SyncPhase.Locked -> "locked"
        SyncPhase.Reset -> "reset"
    }

    fun attention(attention: SyncStatusWords.Attention): String = when (attention) {
        SyncStatusWords.Attention.NONE -> "none"
        SyncStatusWords.Attention.FOLDER -> "folder"
        SyncStatusWords.Attention.PHRASE -> "phrase"
        SyncStatusWords.Attention.RESET -> "reset"
        SyncStatusWords.Attention.STALLED -> "stalled"
    }

    fun status(state: SyncState, inboxProblem: String? = null): Map<String, Any?> = mapOf(
        "inboxProblem" to inboxProblem,
        "phase" to phase(state.phase),
        "statusText" to state.statusText,
        "stalledMessage" to (state.phase as? SyncPhase.Stalled)?.message,
        "attention" to attention(state.words.attention),
        "isEnabled" to state.isEnabled,
        "isSyncing" to state.isSyncing,
        "isDemo" to state.isDemo,
        "pendingDownloads" to state.pendingDownloads,
        "lastSynced" to state.lastSynced?.toDouble(),
        "folderName" to state.folderName,
        "deviceName" to state.deviceName,
        "selectedProfileId" to state.selectedProfileId,
        "showsResetNotice" to (state.phase == SyncPhase.Reset),
    )

    fun check(check: PhraseCheck): Map<String, Any?> = mapOf(
        "wordCount" to check.wordCount,
        "counterText" to check.counterText,
        "isTooLong" to check.isTooLong,
        "problem" to check.problem,
        "isValid" to check.isValid,
    )

    fun connect(result: ConnectResult?): Map<String, Any?> = when (result) {
        null -> mapOf("result" to "cancelled")
        ConnectResult.Connected -> mapOf("result" to "connected")
        is ConnectResult.InvalidPhrase -> mapOf("result" to "invalidPhrase", "problem" to result.problem)
        ConnectResult.Mismatch -> mapOf("result" to "mismatch")
        ConnectResult.NoSyncData -> mapOf("result" to "noSyncData")
        ConnectResult.FolderUnavailable -> mapOf("result" to "folderUnavailable")
        ConnectResult.KeyStoreFailed -> mapOf("result" to "keyStoreFailed")
        ConnectResult.Busy -> mapOf("result" to "busy")
    }

    fun device(device: SyncedDevice): Map<String, Any?> = mapOf(
        "id" to device.id,
        "name" to device.name,
        "kind" to device.kind,
        "lastSeen" to device.lastSeen,
        "isCurrent" to device.isCurrent,
        "canReceiveTabs" to device.canReceiveTabs,
    )

    fun view(snapshot: SyncSnapshot, selectedProfileId: String?, receivers: List<SyncedDevice>): Map<String, Any?> = mapOf(
        "devices" to snapshot.devicesInOrder.map(::device),
        "profiles" to snapshot.profiles.map(::profile),
        "search" to snapshot.search?.let { search ->
            mapOf(
                "engineId" to search.engineId,
                "customURL" to search.customURL,
                "customEngines" to search.customEngines.map { mapOf("id" to it.id, "name" to it.name, "keyword" to it.keyword, "url" to it.url) },
            )
        },
        "syncedAt" to snapshot.syncedAt?.toDouble(),
        "selectedProfileId" to selectedProfileId,
        "receivers" to receivers.map(::device),
    )

    private fun profile(profile: SyncedProfile): Map<String, Any?> = mapOf(
        "syncId" to profile.syncId,
        "name" to profile.name,
        "color" to profile.color,
        "icon" to profile.icon,
        "isDefault" to profile.isDefault,
        "theme" to profile.theme?.let { mapOf("colors" to it.colors, "darkColors" to it.darkColors) },
        "deviceTabs" to profile.deviceTabs.map { tabs ->
            mapOf(
                "deviceId" to tabs.deviceId,
                "deviceName" to tabs.deviceName,
                "kind" to tabs.kind,
                "tabs" to tabs.tabs.map { mapOf("url" to it.url, "title" to it.title) },
            )
        },
        "pinned" to mapOf(
            "tiles" to profile.pinned.tiles.map { tile -> pinnedTab(PinnedTab(tile.key, tile.title, tile.url, tile.icon)) + ("folder" to tile.folder?.map(::pinnedTab)) },
            "sections" to profile.pinned.sections.map(::section),
        ),
        "bookmarks" to profile.bookmarks.map(::bookmark),
        "history" to profile.history.map { mapOf("url" to it.url, "title" to it.title, "visits" to it.visits, "lastVisit" to it.lastVisit) },
        "sendTargets" to profile.sendTargets,
    )

    private fun pinnedTab(tab: PinnedTab): Map<String, Any?> = mapOf("key" to tab.key, "title" to tab.title, "url" to tab.url, "icon" to tab.icon)

    private fun section(section: PinnedSection): Map<String, Any?> = mapOf(
        "tab" to section.tab?.let(::pinnedTab),
        "group" to section.group?.let { group ->
            mapOf("key" to group.key, "name" to group.name, "icon" to group.icon, "color" to group.color, "items" to group.items.map(::section))
        },
    )

    private fun bookmark(item: BookmarkItem): Map<String, Any?> = mapOf(
        "key" to item.key,
        "title" to item.title,
        "url" to item.url,
        "added" to item.added,
        "root" to item.root,
        "children" to item.children?.map(::bookmark),
    )

    fun received(tab: ReceivedTab): Map<String, Any?> = mapOf(
        "key" to tab.key,
        "url" to tab.url,
        "title" to tab.title,
        "fromDevice" to tab.fromDevice,
        "fromDeviceId" to tab.fromDeviceId,
        "sentAt" to tab.sentAt.toDouble(),
        "profileSyncId" to tab.profileSyncId,
    )

    fun inbox(entries: List<PhoneInbox.Entry>): List<Map<String, Any?>> = entries.map { entry ->
        mapOf(
            "id" to entry.id.toDouble(),
            "received" to entry.received.map(::received),
            "removals" to entry.removals.map { mapOf("profileSyncId" to it.profileSyncId, "urls" to it.urls.sorted(), "includesUnassigned" to it.includesUnassigned) },
        )
    }
}
