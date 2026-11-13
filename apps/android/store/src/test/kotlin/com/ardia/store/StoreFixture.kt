package com.ardia.store

import android.content.Context
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteFullException
import androidx.test.core.app.ApplicationProvider
import java.time.ZoneOffset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking

class TestClock(var now: Long) : StoreClock {
    override fun now(): Long = now

    fun advance(millis: Long) {
        now += millis
    }
}

const val HOUR_MS = 3_600_000L
const val DAY_MS = 24 * HOUR_MS

class FailingDatabase(context: Context, name: String? = null) : BrowserDatabase(context, name) {
    @Volatile var failing = false
    var failedCommits = 0
    val poisonedUrls = HashSet<String>()

    override fun writeTabs(changes: Map<String, BrowserTab?>) {
        changes.values.firstOrNull { it?.url in poisonedUrls }?.let { throw SQLiteConstraintException("bad row ${it.url}") }
        super.writeTabs(changes)
    }

    override fun insertVisit(visit: Visit) {
        if (visit.url in poisonedUrls) throw SQLiteConstraintException("bad visit ${visit.url}")
        super.insertVisit(visit)
    }

    @Volatile var failBeforeWork = false

    override fun <T> inTransaction(work: () -> T): T = super.inTransaction {
        if (failing && failBeforeWork) {
            failedCommits++
            throw SQLiteFullException("disk full")
        }
        val result = work()
        if (failing) {
            failedCommits++
            throw SQLiteFullException("disk full")
        }
        result
    }
}

class StoreFixture(private val fileName: String? = null) {
    val context: Context = ApplicationProvider.getApplicationContext()
    val clock = TestClock(1_800_000_000_000L)
    val settings = MemoryKeyValueStore()
    val queue = StoreQueue(Dispatchers.Unconfined)
    var database = FailingDatabase(context, fileName)
        private set
    var store: TabStore = load()
        private set

    val history: HistoryStore get() = store.history

    fun open(url: String): BrowserTab = store.open(TabDestination.Url(url))

    fun relaunch(): TabStore {
        if (fileName != null) {
            database.close()
            database = FailingDatabase(context, fileName)
        }
        store = load()
        return store
    }

    private fun load(): TabStore = runBlocking { TabStore.load(database, settings, queue, clock, ZoneOffset.UTC, Dispatchers.Unconfined, retryDelayMillis = null) }
}
