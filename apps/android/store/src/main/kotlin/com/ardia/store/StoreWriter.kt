package com.ardia.store

import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class StoreWriter internal constructor(
    private val database: BrowserDatabase,
    private val queue: StoreQueue,
    private val retryDelayMillis: Long?,
) {
    private sealed class Entry {
        var sealed = false
    }

    private class TabBatch : Entry() {
        val tabs = LinkedHashMap<String, BrowserTab?>()
    }

    private class Operation(val work: (BrowserDatabase) -> Unit, val afterCommit: (() -> Unit)?) : Entry()

    private val lock = Any()
    private val log = ArrayList<Entry>()
    private var drainScheduled = false
    private var retry: Job? = null
    private val _failure = MutableStateFlow<Throwable?>(null)

    val failure: StateFlow<Throwable?> = _failure.asStateFlow()

    val hasUnsavedChanges: Boolean get() = synchronized(lock) { log.isNotEmpty() }

    fun putTab(tab: BrowserTab) = changeTab(tab.id, tab)

    fun deleteTab(id: String) = changeTab(id, null)

    fun write(afterCommit: (() -> Unit)? = null, work: (BrowserDatabase) -> Unit) {
        synchronized(lock) { log.add(Operation(work, afterCommit)) }
        scheduleDrain()
    }

    suspend fun commit(): Boolean = queue.run { drain() }

    fun commitBlocking(): Boolean = queue.blocking { drain() }

    fun retryNow() {
        if (hasUnsavedChanges) scheduleDrain()
    }

    private fun changeTab(id: String, tab: BrowserTab?) {
        synchronized(lock) {
            val batch = (log.lastOrNull() as? TabBatch)?.takeIf { !it.sealed } ?: TabBatch().also(log::add)
            batch.tabs[id] = tab
        }
        scheduleDrain()
    }

    private fun scheduleDrain() {
        synchronized(lock) {
            if (drainScheduled) return
            drainScheduled = true
        }
        queue.launch { drain() }
    }

    private fun drain(): Boolean {
        val batch = synchronized(lock) {
            drainScheduled = false
            log.forEach { it.sealed = true }
            log.toList()
        }
        if (batch.isEmpty()) return true
        return try {
            database.inTransaction {
                for (entry in batch) {
                    when (entry) {
                        is TabBatch -> database.writeTabs(entry.tabs)
                        is Operation -> entry.work(database)
                    }
                }
            }
            synchronized(lock) { repeat(batch.size) { log.removeAt(0) } }
            _failure.value = null
            batch.forEach { (it as? Operation)?.afterCommit?.invoke() }
            true
        } catch (error: Exception) {
            _failure.value = error
            scheduleRetry()
            false
        }
    }

    private fun scheduleRetry() {
        val delayMillis = retryDelayMillis ?: return
        synchronized(lock) {
            if (retry?.isActive == true) return
            retry = queue.launchAfter(delayMillis) { retryNow() }
        }
    }

    companion object {
        const val RETRY_DELAY_MILLIS = 5_000L
    }
}
