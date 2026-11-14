package com.ardia.store

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.time.ZoneOffset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DemoSeedTest {
    @Test
    fun theDemoHasTheIphonesTabsArchiveAndHistoryInMemory(): Unit = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val clock = TestClock(1_800_000_000_000L)
        val demo = BrowserStore.demo(context, clock, ZoneOffset.UTC, StoreQueue(Dispatchers.Unconfined), Dispatchers.Unconfined)
        val tabs = demo.tabs
        assertEquals(DemoSeed.openPages.map { it.url }, tabs.openTabs.map { it.url })
        assertEquals(DemoSeed.openPages.map { it.title }, tabs.openTabs.map { it.title })
        assertEquals("https://en.wikipedia.org/wiki/Sintra", tabs.selectedTab?.url)
        assertEquals(clock.now - 600 * 60_000L, tabs.openTabs.first().lastActive)
        tabs.loadArchive()
        assertEquals(DemoSeed.archivedPages.map { it.url }, tabs.archive.value.flatMap { day -> day.tabs.map { it.url } })
        assertEquals(clock.now - 5 * HOUR_MS, tabs.archive.value.first().tabs.first().archivedAt)
        assertEquals(DemoSeed.history.size, demo.history.count())
        assertEquals(listOf("best time to visit sintra", "pastéis de nata recipe", "swift concurrency"), demo.history.recentSearches())
        assertTrue(context.databaseList().none { it.startsWith(BrowserDatabase.FILE_NAME) })
        DemoSeed.seed(tabs, clock.now)
        assertEquals(DemoSeed.openPages.size, tabs.openTabs.size)
        demo.close()
    }
}
