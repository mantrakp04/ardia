package com.ardia.store

import kotlinx.coroutines.runBlocking

class SyncBrowsingSource(private val tabs: TabStore) {
    fun syncedTabs(): List<TabRecord> = tabs.syncedTabs()

    fun syncedVisits(since: Long): List<VisitRecord> = runBlocking { tabs.history.syncedVisits(since) }

    fun syncedVisits(urls: Set<String>): List<VisitRecord> = runBlocking { tabs.history.syncedVisits(urls) }

    fun removeVisits(urls: Set<String>, profileSyncId: String?) = runBlocking { tabs.history.removeVisits(urls, profileSyncId) }

    fun receive(incoming: List<IncomingTab>): Boolean = tabs.receive(incoming)
}
