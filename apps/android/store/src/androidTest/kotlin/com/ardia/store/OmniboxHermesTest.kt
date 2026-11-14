package com.ardia.store

import android.os.Debug
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.builtins.serializer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OmniboxHermesTest {
    private val script = HermesCoreScript(InstrumentationRegistry.getInstrumentation().targetContext.assets)
    private val scriptThread = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val omnibox = Omnibox({ script }, PrivateHttp(), null, scriptThread)

    @After
    fun tearDown() {
        runBlocking { withContext(scriptThread) { script.close() } }
        scriptThread.close()
    }

    @Test
    fun resolvesTypedText(): Unit = runBlocking {
        val cases = listOf(
            Triple("apple.com", OmniboxResolution.Kind.URL, "https://apple.com"),
            Triple("  https://example.com/a b  ", OmniboxResolution.Kind.URL, "https://example.com/a%20b"),
            Triple("localhost:3000", OmniboxResolution.Kind.URL, "http://localhost:3000"),
            Triple("how tall is everest", OmniboxResolution.Kind.SEARCH, "https://www.google.com/search?q=how%20tall%20is%20everest"),
            Triple("?apple.com", OmniboxResolution.Kind.SEARCH, "https://www.google.com/search?q=apple.com"),
            Triple("weather tomorrow !w", OmniboxResolution.Kind.BANG, "https://wikipedia.org/w/index.php?search=weather+tomorrow"),
            Triple("!yt", OmniboxResolution.Kind.BANG, "https://www.youtube.com/"),
        )
        for ((text, kind, url) in cases) {
            val resolution = omnibox.resolve(text)
            assertNotNull(text, resolution)
            assertEquals(text, kind, resolution!!.kind)
            assertEquals(text, url, resolution.url)
        }
        assertNull(omnibox.resolve("   "))
    }

    @Test
    fun usesTheSyncedEngineAndItsCustomEngines(): Unit = runBlocking {
        val custom = CustomSearchEngine("c1", "Docs", "docs", "https://docs.example/?q=%s")
        assertEquals("DuckDuckGo", omnibox.setSearch(SearchChoice("duckduckgo", null, listOf(custom)), "google")?.name)
        assertTrue(omnibox.engines().any { it.id == "c1" && it.custom == true })
        assertEquals("https://duckduckgo.com/?q=rust%20book", omnibox.resolve("rust book")?.url)
        omnibox.setSearch(null, "bing")
        assertEquals("https://www.bing.com/search?q=rust%20book", omnibox.resolve("rust book")?.url)
        omnibox.setSearch(SearchChoice("missing"), "bing")
        assertEquals("Google", omnibox.resolve("x y")?.engine)
    }

    @Test
    fun ranksMacHistoryAndCompletesInline(): Unit = runBlocking {
        val now = 1_800_000_000_000L
        val synced = SyncedBrowsing(
            history = listOf(
                HistoryRow("https://github.com/apple/swift", "apple/swift", null, 40, (now - 3_600_000).toDouble()),
                HistoryRow("https://gist.github.com/x", "A gist", null, 1, (now - 20 * 86_400_000L).toDouble()),
            ),
            deviceTabs = listOf(
                SyncedBrowsing.DeviceTabs("mac", "MacBook Pro", isMac = true, isCurrent = false, tabs = listOf(SyncedBrowsing.RemoteTab("https://linear.app/team/issue/ARD-1", "ARD-1 Sync"))),
            ),
            bookmarks = listOf(CandidateBookmark("https://forums.swift.org/", "Swift Forums")),
            syncedAt = now,
        )
        val local = listOf(HistoryRow("https://github.com/apple/swift", "", null, 3, now.toDouble()))
        omnibox.setCandidates(OmniboxCandidates.merge(emptyList(), local, synced, now))

        val typed = omnibox.suggest("git", now = now)
        assertEquals("hub.com", typed.inlineCompletion)
        assertEquals("https://github.com/", (typed.suggestions.first() as OmniboxSuggestion.Page).url)
        assertTrue(typed.suggestions.any { it is OmniboxSuggestion.Search && it.query == "git" })
        val swift = omnibox.suggest("swift forums", now = now)
        assertTrue(swift.suggestions.any { it is OmniboxSuggestion.Page && it.url == "https://forums.swift.org/" && it.bookmarked })
        assertTrue(omnibox.suggest("ARD-1", now = now).suggestions.any { it.url == "https://linear.app/team/issue/ARD-1" })
        assertTrue(omnibox.suggest("12*(3+4)", now = now).suggestions.any { it is OmniboxSuggestion.Calculation && it.value == "84" })
    }

    @Test
    fun keystrokesAnswerFastWithALargeHistory(): Unit = runBlocking {
        val now = System.currentTimeMillis()
        val history = (0 until 5000).map { index ->
            HistoryRow("https://site${index % 700}.example.com/path/$index", "Page $index about topic ${index % 37}", null, index % 9 + 1, (now - index * 60_000L).toDouble())
        }
        omnibox.setCandidates(OmniboxCandidates(history = history))
        val keystrokes = listOf("si", "sit", "site", "site4", "site42", "topic", "topic 3", "page 49")
        repeat(5) { keystrokes.forEach { omnibox.suggest(it) } }
        val samples = keystrokes.map { ArrayList<Long>() }
        repeat(9) {
            keystrokes.forEachIndexed { index, prefix ->
                samples[index] += withContext(scriptThread) {
                    val start = Debug.threadCpuTimeNanos()
                    script.call("mobileSuggest", listOf(Omnibox.encode(String.serializer(), prefix)))
                    Debug.threadCpuTimeNanos() - start
                }
            }
        }
        val medians = samples.map { it.sorted()[it.size / 2] / 1_000_000.0 }
        val slowest = keystrokes.zip(medians).maxBy { it.second }
        Log.i("ArdiaTiming", "store omnibox keystroke medians ms: ${keystrokes.zip(medians)}")
        assertTrue("\"${slowest.first}\" took ${slowest.second} ms of thread time at the median", slowest.second < 16.0)
    }

    @Test
    fun theFirstKeystrokeIsAnsweredWhileFiveThousandRowsAreStillLoading(): Unit = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val model = OmniboxModel(omnibox, scope)
        model.fetchesNetworkSuggestions = false
        val now = System.currentTimeMillis()
        val full = (0 until 5000).map { HistoryRow("https://site$it.example/", "Site $it", null, 1, (now - it * 60_000L).toDouble()) }
        val history = OmniboxModel.HistorySource { limit ->
            if (limit == OmniboxModel.SEED_ROWS) {
                full.take(limit)
            } else {
                delay(2_000)
                full
            }
        }
        withContext(Dispatchers.Main) {
            model.refreshCandidates(emptyList(), history, null)
            delay(200)
            val start = System.nanoTime()
            model.update("site1")
            withTimeout(500) { model.result.first { it.query == "site1" } }
            val millis = (System.nanoTime() - start) / 1_000_000.0
            Log.i("ArdiaTiming", "first keystroke during the history load answered in $millis ms")
            assertTrue(millis < 100)
            assertTrue(!model.candidatesComplete.value)
            withTimeout(10_000) { model.candidatesComplete.first { it } }
            model.close()
        }
    }

    @Test
    fun remoteSuggestionsAreOffForUrlsAndBangs(): Unit = runBlocking {
        assertTrue(omnibox.remoteSuggestions("https://example.com").isEmpty())
        assertTrue(omnibox.remoteSuggestions("cats !w").isEmpty())
    }

    @Test
    fun cleansTrackersAndFormatsTheToolbarLabel(): Unit = runBlocking {
        assertEquals("https://example.com/a?id=7", omnibox.cleanUrl("https://example.com/a?utm_source=x&id=7&fbclid=abc"))
        val display = omnibox.display("https://www.xn--bcher-kva.de/b", "Books | Bücher")
        assertEquals("bücher.de", display.host)
        assertEquals(listOf("Books", "Bücher"), display.trail)
    }
}
