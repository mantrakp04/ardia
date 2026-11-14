package com.ardia.phone

import com.ardia.sync.BookmarkItem
import com.ardia.sync.SyncSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class PhonePins {
    private val mutablePending = MutableStateFlow<Set<Pair<String, String>>>(emptySet())

    val pending: StateFlow<Set<Pair<String, String>>> = mutablePending.asStateFlow()

    fun pinned(profileSyncId: String, url: String) = mutablePending.update { it + (profileSyncId to url) }

    fun waiting(snapshot: SyncSnapshot): Set<Pair<String, String>> {
        val arrived = mutablePending.value.filter { (profile, url) -> snapshot.profiles.firstOrNull { it.syncId == profile }?.bookmarks?.holds(url) == true }.toSet()
        if (arrived.isNotEmpty()) mutablePending.update { it - arrived }
        return mutablePending.value - arrived
    }

    fun clear() = mutablePending.update { emptySet() }

    private fun List<BookmarkItem>.holds(url: String): Boolean = any { it.url == url || it.children.orEmpty().holds(url) }
}
