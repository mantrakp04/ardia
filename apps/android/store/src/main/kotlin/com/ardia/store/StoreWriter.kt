package com.ardia.store

import android.database.sqlite.SQLiteAccessPermException
import android.database.sqlite.SQLiteBindOrColumnIndexOutOfRangeException
import android.database.sqlite.SQLiteBlobTooBigException
import android.database.sqlite.SQLiteCantOpenDatabaseException
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteDatabaseLockedException
import android.database.sqlite.SQLiteDatatypeMismatchException
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteFullException
import android.database.sqlite.SQLiteMisuseException
import android.database.sqlite.SQLiteOutOfMemoryException
import android.database.sqlite.SQLiteReadOnlyDatabaseException
import java.io.IOException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class QuarantinedWrite(val kind: Kind, val key: String, val error: String) {
    enum class Kind { TAB, PAGE_STATE, VISIT, OPERATION }
}

class StoreWriteException(message: String, cause: Throwable?) : Exception(message, cause)

class StoreWriter internal constructor(
    private val database: BrowserDatabase,
    private val queue: StoreQueue,
    private val retryDelayMillis: Long?,
) {
    private class PendingVisit(val visit: Visit, val isNew: Boolean)

    private sealed class Segment

    private class Batch : Segment() {
        val tabs = LinkedHashMap<String, BrowserTab?>()
        val states = LinkedHashMap<String, ByteArray?>()
        val visits = LinkedHashMap<Long, PendingVisit>()

        val isEmpty: Boolean get() = tabs.isEmpty() && states.isEmpty() && visits.isEmpty()

        fun copy() = Batch().also {
            it.tabs.putAll(tabs)
            it.states.putAll(states)
            it.visits.putAll(visits)
        }

        fun absorb(later: Batch) {
            later.tabs.forEach { (id, tab) -> tabs[id] = tab }
            later.states.forEach { (id, state) -> states[id] = state }
            later.visits.forEach { (id, pending) -> visits[id] = if (visits[id]?.isNew == true) PendingVisit(pending.visit, true) else pending }
        }
    }

    private class Barrier(val key: String, val covers: ((Visit) -> Boolean)?, val work: (BrowserDatabase) -> Unit, val afterCommit: (() -> Unit)?) : Segment()

    private sealed class Item {
        abstract val kind: QuarantinedWrite.Kind
        abstract val key: String
    }

    private class TabItem(val id: String, val tab: BrowserTab?) : Item() {
        override val kind = QuarantinedWrite.Kind.TAB
        override val key = id
    }

    private class StateItem(val id: String, val data: ByteArray?) : Item() {
        override val kind = QuarantinedWrite.Kind.PAGE_STATE
        override val key = id
    }

    private class VisitItem(val pending: PendingVisit) : Item() {
        override val kind = QuarantinedWrite.Kind.VISIT
        override val key = "${pending.visit.id}"
    }

    private class BarrierItem(val barrier: Barrier) : Item() {
        override val kind = QuarantinedWrite.Kind.OPERATION
        override val key = barrier.key
    }

    private val lock = Any()
    private val segments = ArrayList<Segment>()
    private val quarantinedTabs = HashSet<String>()
    private var drainScheduled = false
    private var backingOff = false
    private val droppedVisitIds = LinkedHashSet<Long>()
    private var retry: Job? = null
    private var lastPermanent: Throwable? = null
    private val _failure = MutableStateFlow<Throwable?>(null)
    private val _quarantine = MutableStateFlow<List<QuarantinedWrite>>(emptyList())
    private val _droppedVisits = MutableStateFlow(0)

    val failure: StateFlow<Throwable?> = _failure.asStateFlow()
    val quarantine: StateFlow<List<QuarantinedWrite>> = _quarantine.asStateFlow()
    val droppedVisits: StateFlow<Int> = _droppedVisits.asStateFlow()

    var onCommit: (() -> Unit)? = null

    val hasUnsavedChanges: Boolean get() = synchronized(lock) { segments.isNotEmpty() }

    internal val retainedEntries: Int
        get() = synchronized(lock) {
            segments.sumOf { segment -> if (segment is Batch) segment.tabs.size + segment.states.size + segment.visits.size else 1 }
        }

    internal val retainedSegments: Int get() = synchronized(lock) { segments.size }

    fun putTab(tab: BrowserTab) = changeBatch { it.tabs[tab.id] = tab }

    fun deleteTab(id: String) = changeBatch {
        it.tabs[id] = null
        it.states.remove(id)
    }

    fun saveState(id: String, data: ByteArray?) = changeBatch { it.states[id] = data }

    fun putVisit(visit: Visit, isNew: Boolean) {
        synchronized(lock) {
            val batch = lastBatch()
            val existing = batch.visits[visit.id]
            if (existing == null) {
                val belongsToDropped = !isNew && visit.id in droppedVisitIds
                if (belongsToDropped || pendingVisitCount() >= MAX_PENDING_VISITS) {
                    if (isNew) rememberDropped(visit.id)
                    _droppedVisits.value += 1
                    _failure.value = problem()
                    return
                }
            }
            batch.visits[visit.id] = PendingVisit(visit, isNew || existing?.isNew == true)
        }
        scheduleDrain()
    }

    fun barrier(key: String, covers: ((Visit) -> Boolean)? = null, afterCommit: (() -> Unit)? = null, work: (BrowserDatabase) -> Unit) {
        synchronized(lock) {
            if (covers != null) {
                for (segment in segments) if (segment is Batch) segment.visits.values.removeAll { covers(it.visit) }
                segments.removeAll { it is Batch && it.isEmpty }
            }
            val last = segments.lastOrNull()
            if (last !is Barrier || last.key != key) segments.add(Barrier(key, covers, work, afterCommit))
        }
        scheduleDrain()
    }

    fun isUnsavedTab(id: String): Boolean = synchronized(lock) {
        id in quarantinedTabs || segments.any { it is Batch && it.tabs.containsKey(id) }
    }

    suspend fun commit(): Boolean = queue.run { drain() }

    fun commitBlocking(): Boolean = queue.blocking { drain() }

    fun retryNow() {
        synchronized(lock) { backingOff = false }
        if (hasUnsavedChanges) scheduleDrain()
    }

    fun acknowledgeProblems() {
        synchronized(lock) {
            _quarantine.value = emptyList()
            quarantinedTabs.clear()
            _droppedVisits.value = 0
            lastPermanent = null
            if (segments.isEmpty()) _failure.value = null
        }
    }

    private inline fun changeBatch(change: (Batch) -> Unit) {
        synchronized(lock) { change(lastBatch()) }
        scheduleDrain()
    }

    private fun lastBatch(): Batch = segments.lastOrNull() as? Batch ?: Batch().also(segments::add)

    private fun rememberDropped(id: Long) {
        droppedVisitIds.add(id)
        if (droppedVisitIds.size > MAX_PENDING_VISITS) droppedVisitIds.remove(droppedVisitIds.first())
    }

    private fun pendingVisitCount(): Int = segments.sumOf { if (it is Batch) it.visits.size else 0 }

    private fun scheduleDrain() {
        synchronized(lock) {
            if (drainScheduled || backingOff) return
            drainScheduled = true
        }
        queue.launch { drain() }
    }

    private fun drain(): Boolean {
        val snapshot = synchronized(lock) {
            drainScheduled = false
            segments.map { segment -> segment to if (segment is Batch) segment.copy() else segment }
        }
        if (snapshot.isEmpty()) return true
        try {
            database.inTransaction { snapshot.forEach { (_, copy) -> apply(copy) } }
        } catch (error: Exception) {
            if (isRetryable(error)) return failed(error)
            return isolate(snapshot)
        }
        val callbacks = synchronized(lock) {
            snapshot.forEach { (live, copy) -> settle(live, copy) }
            compact()
            snapshot.mapNotNull { (it.first as? Barrier)?.afterCommit }
        }
        committed(callbacks)
        return !hasUnsavedChanges
    }

    private fun isolate(snapshot: List<Pair<Segment, Segment>>): Boolean {
        for ((live, copy) in snapshot) {
            for (item in items(copy)) {
                try {
                    database.inTransaction { apply(item) }
                } catch (error: Exception) {
                    if (isRetryable(error)) {
                        synchronized(lock) { compact() }
                        return failed(error)
                    }
                    synchronized(lock) { quarantine(item, error) }
                    removeItem(live, item)
                    continue
                }
                removeItem(live, item)
                if (item is BarrierItem) item.barrier.afterCommit?.let { committed(listOf(it)) }
            }
        }
        synchronized(lock) { compact() }
        committed(emptyList())
        return !hasUnsavedChanges
    }

    private fun items(segment: Segment): List<Item> = when (segment) {
        is Barrier -> listOf(BarrierItem(segment))
        is Batch -> segment.tabs.map { (id, tab) -> TabItem(id, tab) } +
            segment.states.map { (id, data) -> StateItem(id, data) } +
            segment.visits.values.map(::VisitItem)
    }

    private fun apply(segment: Segment) {
        when (segment) {
            is Barrier -> segment.work(database)
            is Batch -> {
                database.writeTabs(segment.tabs)
                segment.states.forEach { (id, data) -> database.saveState(id, data) }
                segment.visits.values.forEach { if (it.isNew) database.insertVisit(it.visit) else database.updateVisit(it.visit) }
            }
        }
    }

    private fun apply(item: Item) {
        when (item) {
            is TabItem -> database.writeTabs(mapOf(item.id to item.tab))
            is StateItem -> database.saveState(item.id, item.data)
            is VisitItem -> if (item.pending.isNew) database.insertVisit(item.pending.visit) else database.updateVisit(item.pending.visit)
            is BarrierItem -> item.barrier.work(database)
        }
    }

    private fun removeItem(live: Segment, item: Item) = synchronized(lock) {
        when (item) {
            is BarrierItem -> segments.remove(live)
            is TabItem -> (live as Batch).tabs.let { if (it.containsKey(item.id) && it[item.id] == item.tab) it.remove(item.id) }
            is StateItem -> (live as Batch).states.let { if (it.containsKey(item.id) && it[item.id] === item.data) it.remove(item.id) }
            is VisitItem -> (live as Batch).visits.let { if (it[item.pending.visit.id] === item.pending) it.remove(item.pending.visit.id) }
        }
    }

    private fun settle(live: Segment, copy: Segment) {
        if (live is Barrier) {
            segments.remove(live)
            return
        }
        val batch = live as Batch
        val written = copy as Batch
        written.tabs.forEach { (id, tab) -> if (batch.tabs.containsKey(id) && batch.tabs[id] == tab) batch.tabs.remove(id) }
        written.states.forEach { (id, data) -> if (batch.states.containsKey(id) && batch.states[id] === data) batch.states.remove(id) }
        written.visits.forEach { (id, pending) -> if (batch.visits[id] === pending) batch.visits.remove(id) }
    }

    private fun compact() {
        segments.removeAll { it is Batch && it.isEmpty }
        var index = 1
        while (index < segments.size) {
            val earlier = segments[index - 1]
            val later = segments[index]
            if (earlier is Batch && later is Batch) {
                earlier.absorb(later)
                segments.removeAt(index)
            } else {
                index++
            }
        }
    }

    private fun quarantine(item: Item, error: Exception) {
        lastPermanent = error
        if (item is TabItem) quarantinedTabs.add(item.id)
        val entry = QuarantinedWrite(item.kind, item.key, "${error.javaClass.simpleName}: ${error.message}")
        val list = _quarantine.value
        _quarantine.value = if (list.size < MAX_QUARANTINE) list + entry else list
    }

    private fun committed(callbacks: List<() -> Unit>) {
        synchronized(lock) {
            backingOff = false
            _failure.value = problem()
        }
        callbacks.forEach { it() }
        onCommit?.invoke()
    }

    private fun failed(error: Exception): Boolean {
        _failure.value = error
        scheduleRetry()
        return false
    }

    private fun problem(): Throwable? {
        val quarantined = _quarantine.value.size
        val dropped = _droppedVisits.value
        if (quarantined == 0 && dropped == 0) return null
        return StoreWriteException("$quarantined writes could not be saved and $dropped visits were not kept", lastPermanent)
    }

    private fun scheduleRetry() {
        val delayMillis = retryDelayMillis ?: return
        synchronized(lock) {
            backingOff = true
            if (retry?.isActive == true) return
            retry = queue.launchAfter(delayMillis) { retryNow() }
        }
    }

    companion object {
        const val RETRY_DELAY_MILLIS = 5_000L
        const val MAX_PENDING_VISITS = 5_000
        const val MAX_QUARANTINE = 500

        fun isRetryable(error: Throwable): Boolean = when (error) {
            is SQLiteConstraintException,
            is SQLiteDatabaseCorruptException,
            is SQLiteDatatypeMismatchException,
            is SQLiteMisuseException,
            is SQLiteBindOrColumnIndexOutOfRangeException,
            is SQLiteBlobTooBigException -> false
            is SQLiteFullException,
            is SQLiteDiskIOException,
            is SQLiteDatabaseLockedException,
            is SQLiteCantOpenDatabaseException,
            is SQLiteReadOnlyDatabaseException,
            is SQLiteAccessPermException,
            is SQLiteOutOfMemoryException -> true
            is SQLiteException -> true
            is IOException -> true
            else -> false
        }
    }
}
