package com.ardia.store

import android.content.Context
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

class StoreFixture(private val fileName: String? = null) {
    val context: Context = ApplicationProvider.getApplicationContext()
    val clock = TestClock(1_800_000_000_000L)
    val settings = MemoryKeyValueStore()
    val queue = StoreQueue(Dispatchers.Unconfined)
    var database = BrowserDatabase(context, fileName)
        private set
    var store: TabStore = load()
        private set

    val history: HistoryStore get() = store.history

    fun open(url: String): BrowserTab = store.open(TabDestination.Url(url))

    fun relaunch(): TabStore {
        if (fileName != null) {
            database.close()
            database = BrowserDatabase(context, fileName)
        }
        store = load()
        return store
    }

    private fun load(): TabStore = runBlocking { TabStore.load(database, settings, queue, clock, ZoneOffset.UTC, Dispatchers.Unconfined) }
}
