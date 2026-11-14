package com.ardia.blocking

import android.content.Context
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BlockingOnDeviceTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun bundledDataLoadsFromThePackage() {
        assertTrue(FilterListCatalog.bundled.lists.size > 50)
        assertTrue(BlockingScripts.consent.contains("#onetrust-reject-all-handler"))
        assertEquals("bbc.co.uk", PublicSuffixes.shared.registrableDomain("news.bbc.co.uk"))
    }

    @Test
    fun settingsPersistInSharedPreferences() {
        val preferences = context.getSharedPreferences("ardia-blocking-test", Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        val settings = BlockingSettings(SharedPreferencesBlockingStore(preferences))
        settings.blocksTrackers = false
        settings.setExempt("www.example.com", true)
        val reloaded = BlockingSettings(SharedPreferencesBlockingStore(preferences))
        assertFalse(reloaded.blocksTrackers)
        assertTrue(reloaded.isExempt("news.example.com"))
        preferences.edit().clear().commit()
    }

    @Test
    fun matchingOnTheDeviceStaysFast() = runBlocking {
        val directory = File(context.cacheDir, "ardia-blocking-speed").apply { deleteRecursively() }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val store = InMemoryBlockingStore()
            val blocker = ContentBlocker(BlockingSettings(store), FilterLists(directory, store, HttpFilterListDownloader(), scope = scope), scope)
            val urls = listOf(
                "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
                "https://www.google-analytics.com/g/collect?v=2&tid=G-1&cid=1.2",
                "https://i.guim.co.uk/img/media/abc/master/3000.jpg?width=620&quality=85",
                "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
            )
            repeat(5_000) { blocker.blocks(urls[it % urls.size], "https://www.theguardian.com/", false) }
            val runs = 50_000
            val start = System.nanoTime()
            repeat(runs) { blocker.blocks(urls[it % urls.size], "https://www.theguardian.com/", false) }
            val micros = (System.nanoTime() - start) / runs / 1000.0
            Log.i("ArdiaTiming", "blocking seeds: %.2f us per request".format(micros))
            assertTrue(micros < 50)
        } finally {
            scope.cancel()
            directory.deleteRecursively()
        }
    }
}
