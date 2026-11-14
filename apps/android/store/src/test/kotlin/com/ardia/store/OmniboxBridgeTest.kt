package com.ardia.store

import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeCore : CoreScript {
    val calls = ArrayList<Pair<String, List<String>>>()
    val answers = HashMap<String, (List<String>) -> String>()

    override fun call(function: String, arguments: List<String>): String {
        calls.add(function to arguments)
        return answers[function]?.invoke(arguments) ?: "null"
    }

    fun count(function: String) = calls.count { it.first == function }

    fun last(function: String) = calls.last { it.first == function }.second
}

class FakeHttp(var answer: HttpResult? = null) : OmniboxHttp {
    val requests = ArrayList<Pair<String, Map<String, String>>>()

    override fun get(url: String, headers: Map<String, String>, timeoutMillis: Int, maxBytes: Int): HttpResult? {
        requests.add(url to headers)
        return answer
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class OmniboxBridgeTest {
    private val core = FakeCore()
    private val http = FakeHttp()

    private fun TestScope.omnibox(directory: File? = null): Omnibox {
        val dispatcher = StandardTestDispatcher(testScheduler)
        return Omnibox({ core }, http, directory, dispatcher, dispatcher) { testScheduler.currentTime }
    }

    private fun echoSuggest() {
        core.answers["mobileSuggest"] = { arguments ->
            val text = Json.decodeFromString<String>(arguments[0])
            """{"items":[{"kind":"search","query":${JsonPrimitive(text)},"url":"https://s.example/?q=$text","engine":"Google"}],"completion":""}"""
        }
    }

    @Test
    fun suggestionsDecodeEveryKindTheAppShowsAndCarryTheContext() = runTest {
        core.answers["mobileSuggest"] = {
            """{"items":[
                {"kind":"page","url":"https://github.com/","title":"GitHub","favicon":null,"tabId":"T1","bookmarked":true,"visited":true},
                {"kind":"search","query":"git","url":"https://s.example/?q=git","engine":"Google","suggested":true},
                {"kind":"calc","expression":"1+1","value":"2","url":"https://s.example/?q=1%2B1"},
                {"kind":"action","id":"x","title":"Not on phones"}
            ],"completion":"hub.com"}"""
        }
        val result = omnibox().suggest("git", OmniboxContext(currentUrl = "https://here.example/", currentTabId = "T9", prefersSearch = true), listOf("git log"), now = 42)
        assertEquals("hub.com", result.inlineCompletion)
        assertEquals(
            listOf(
                OmniboxSuggestion.Page("https://github.com/", "GitHub", null, "T1", bookmarked = true, visited = true),
                OmniboxSuggestion.Search("git", "https://s.example/?q=git", "Google", suggested = true, isBang = false),
                OmniboxSuggestion.Calculation("1+1", "2", "https://s.example/?q=1%2B1"),
            ),
            result.suggestions,
        )
        val (text, options) = core.last("mobileSuggest")
        assertEquals("\"git\"", text)
        val sent = Json.parseToJsonElement(options).jsonObject
        assertEquals("search", sent["preference"]!!.jsonPrimitive.content)
        assertEquals("T9", sent["currentTabId"]!!.jsonPrimitive.content)
        assertEquals("42.0", sent["now"]!!.jsonPrimitive.content)
        assertEquals(listOf("git log"), sent["remote"]!!.jsonArray.map { it.jsonPrimitive.content })
    }

    @Test
    fun aBrokenScriptAnswerFallsBackToNoSuggestions() = runTest {
        core.answers["mobileSuggest"] = { throw IllegalStateException("script died") }
        assertEquals(OmniboxResult("git", emptyList(), ""), omnibox().suggest("git"))
        core.answers["mobileResolve"] = { "{not json" }
        assertNull(omnibox().resolve("x"))
    }

    @Test
    fun theSameSourcesAreSentOnlyOnce() = runTest {
        core.answers["mobileSetSources"] = { "true" }
        val omnibox = omnibox()
        val candidates = OmniboxCandidates(history = listOf(HistoryRow("https://a.example/", "A", null, 2, 1.0)))
        assertTrue(omnibox.setCandidates(candidates))
        assertTrue(!omnibox.setCandidates(candidates))
        assertTrue(omnibox.setCandidates(candidates.copy(tabs = listOf(CandidateTab("T", "https://t.example/", "T")))))
        assertEquals(2, core.count("mobileSetSources"))
        val sent = Json.parseToJsonElement(core.last("mobileSetSources")[0]).jsonObject
        assertEquals(setOf("tabs", "history", "bookmarks"), sent.keys)
        assertTrue(omnibox.hasHistory)
    }

    @Test
    fun resolutionKindsAndEngineChoicesCrossTheBridge() = runTest {
        val omnibox = omnibox()
        core.answers["mobileResolve"] = { """{"kind":"bang","url":"https://wikipedia.org/w/index.php?search=x","query":"x","engine":"Wikipedia"}""" }
        assertEquals(OmniboxResolution(OmniboxResolution.Kind.BANG, "https://wikipedia.org/w/index.php?search=x", "x", "Wikipedia"), omnibox.resolve("x !w"))
        core.answers["mobileResolve"] = { "null" }
        assertNull(omnibox.resolve("  "))
        core.answers["mobileSetSearch"] = { """{"id":"duckduckgo","name":"DuckDuckGo","url":"https://duckduckgo.com/?q=%s","suggests":true}""" }
        val custom = CustomSearchEngine("c1", "Docs", "docs", "https://docs.example/?q=%s")
        assertEquals("DuckDuckGo", omnibox.setSearch(SearchChoice("duckduckgo", null, listOf(custom)), "google")?.name)
        val input = Json.parseToJsonElement(core.last("mobileSetSearch")[0]).jsonObject
        assertEquals("duckduckgo", input["engineId"]!!.jsonPrimitive.content)
        assertEquals("docs", (input["customEngines"] as JsonArray)[0].jsonObject["keyword"]!!.jsonPrimitive.content)
        omnibox.setSearch(null, "bing")
        assertEquals("bing", Json.parseToJsonElement(core.last("mobileSetSearch")[0]).jsonObject["engineId"]!!.jsonPrimitive.content)
        core.answers["mobileEngines"] = { """[{"id":"google","name":"Google","url":"u","custom":false},{"id":"c1","name":"Docs","url":"d","custom":true}]""" }
        assertEquals(listOf("google", "c1"), omnibox.engines().map { it.id })
    }

    @Test
    fun networkSuggestionsAreFetchedOnlyWhenTheScriptGivesAnAddress() = runTest {
        val omnibox = omnibox()
        assertTrue(omnibox.remoteSuggestions("https://example.com").isEmpty())
        assertTrue(http.requests.isEmpty())
        core.answers["mobileSuggestRequest"] = { "\"https://suggest.example/?q=cats\"" }
        core.answers["mobileParseRemote"] = { arguments -> if (Json.decodeFromString<String>(arguments[0]) == "[\"cats\",[\"cats and dogs\"]]") "[\"cats and dogs\"]" else "[]" }
        http.answer = HttpResult(200, "[\"cats\",[\"cats and dogs\"]]".toByteArray(), null)
        assertEquals(listOf("cats and dogs"), omnibox.remoteSuggestions("cats"))
        assertEquals("https://suggest.example/?q=cats" to mapOf("Accept" to "application/json"), http.requests.single())
        http.answer = HttpResult(503, ByteArray(0), null)
        assertTrue(omnibox.remoteSuggestions("cats").isEmpty())
    }

    @Test
    fun bangsLoadFromDiskAndRefreshWeeklyWithTheEtag() = runTest {
        val directory = Files.createTempDirectory("bangs").toFile()
        val file = File(directory, "bangs.txt")
        file.writeText("etag-1\nbangs")
        file.setLastModified(1_000_000)
        core.answers["mobileLoadBangDocument"] = { "\"etag-1\"" }
        val omnibox = omnibox(directory)
        omnibox.refreshBangsIfDue(1_000_000 + 6 * DAY_MS)
        assertTrue(http.requests.isEmpty())
        http.answer = HttpResult(304, ByteArray(0), null)
        omnibox.refreshBangsIfDue(1_000_000 + 8 * DAY_MS)
        assertEquals(Omnibox.BANG_LIST_URL to mapOf("If-None-Match" to "etag-1"), http.requests.single())
        assertEquals(0, core.count("mobileBangDocument"))
        http.answer = HttpResult(200, "{}".toByteArray(), "etag-2")
        core.answers["mobileBangDocument"] = { "\"etag-2\\nnew\"" }
        omnibox.refreshBangsIfDue(1_000_000 + 16 * DAY_MS)
        assertEquals("etag-2\nnew", file.readText())
        assertEquals(1, core.count("mobileLoadBangDocument"))
        directory.deleteRecursively()
    }

    @Test
    fun theFirstKeystrokeNeverWaitsForTheFullHistory() = runTest {
        echoSuggest()
        core.answers["mobileSetSources"] = { "true" }
        val omnibox = omnibox()
        val model = OmniboxModel(omnibox, this, { testScheduler.currentTime })
        model.fetchesNetworkSuggestions = false
        val seed = (0 until OmniboxModel.SEED_ROWS).map { HistoryRow("https://s$it.example/", "S", null, 1, 0.0) }
        val full = (0 until 5000).map { HistoryRow("https://f$it.example/", "F", null, 1, 0.0) }
        val history = OmniboxModel.HistorySource { limit ->
            if (limit == OmniboxModel.SEED_ROWS) {
                seed
            } else {
                delay(5_000)
                full
            }
        }
        model.refreshCandidates(listOf(CandidateTab("T1", "https://tab.example/", "Tab")), history, null)
        runCurrent()
        assertEquals(1, core.count("mobileSetSources"))
        model.update("gi")
        runCurrent()
        assertEquals("gi", model.result.value.query)
        advanceTimeBy(4_900)
        model.update("git")
        runCurrent()
        advanceTimeBy(150)
        assertEquals(1, core.count("mobileSetSources"))
        advanceTimeBy(400)
        assertEquals(2, core.count("mobileSetSources"))
        val sent = Json.parseToJsonElement(core.last("mobileSetSources")[0]).jsonObject
        assertEquals(5000, sent["history"]!!.jsonArray.size)
        assertEquals("\"git\"", core.last("mobileSuggest")[0])
        assertTrue(model.candidatesComplete.value)

        model.refreshCandidates(emptyList(), history, null)
        advanceTimeBy(6_000)
        assertEquals("the second search skips the seed", 3, core.count("mobileSetSources"))
        model.close()
    }

    @Test
    fun networkSuggestionsWaitForAPauseAndCarryOverToLongerText() = runTest {
        core.answers["mobileSuggest"] = { arguments ->
            val remote = Json.parseToJsonElement(arguments[1]).jsonObject["remote"]!!.jsonArray.map { it.jsonPrimitive.content }
            val items = remote.joinToString(",") { """{"kind":"search","query":"$it","url":"https://s.example/?q=$it","engine":"Google","suggested":true}""" }
            """{"items":[$items],"completion":""}"""
        }
        core.answers["mobileSuggestRequest"] = { arguments -> "\"https://suggest.example/?q=${Json.decodeFromString<String>(arguments[0])}\"" }
        core.answers["mobileParseRemote"] = { "[\"github desktop\",\"git rebase\"]" }
        http.answer = HttpResult(200, "body".toByteArray(), null)
        val model = OmniboxModel(omnibox(), this, { testScheduler.currentTime })

        model.update("g")
        advanceTimeBy(50)
        model.update("gi")
        advanceTimeBy(50)
        model.update("git")
        runCurrent()
        assertTrue(model.result.value.suggestions.isEmpty())
        advanceTimeBy(200)
        assertEquals(listOf("https://suggest.example/?q=git"), http.requests.map { it.first })
        assertEquals(listOf("github desktop", "git rebase"), model.result.value.suggestions.map { (it as OmniboxSuggestion.Search).query })

        model.update("gith")
        runCurrent()
        assertEquals(listOf("github desktop"), model.result.value.suggestions.map { (it as OmniboxSuggestion.Search).query })
        model.update("gitx")
        runCurrent()
        assertTrue(model.result.value.suggestions.isEmpty())
        model.clear()
        assertEquals(OmniboxResult.empty, model.result.value)
        model.close()
    }

    @Test
    fun macHistoryAndTabsJoinTheLocalHistory() {
        val now = 1_800_000_000_000L
        val synced = SyncedBrowsing(
            history = listOf(HistoryRow("https://github.com/apple/swift", "apple/swift", null, 40, (now - HOUR_MS).toDouble())),
            deviceTabs = listOf(
                SyncedBrowsing.DeviceTabs("mac", "MacBook Pro", isMac = true, isCurrent = false, tabs = listOf(SyncedBrowsing.RemoteTab("https://linear.app/ARD-1", "ARD-1"), SyncedBrowsing.RemoteTab("ardia://x", "x"))),
                SyncedBrowsing.DeviceTabs("me", "This Phone", isMac = false, isCurrent = true, tabs = listOf(SyncedBrowsing.RemoteTab("https://mine.example/", "Mine"))),
            ),
            bookmarks = listOf(CandidateBookmark("https://forums.swift.org/", "Swift Forums")),
            syncedAt = now,
        )
        val local = listOf(HistoryRow("https://github.com/apple/swift", "", null, 3, now.toDouble()))
        val merged = OmniboxCandidates.merge(emptyList(), local, synced, now)
        val swift = merged.history.first { it.url == "https://github.com/apple/swift" }
        assertEquals(40, swift.visits)
        assertEquals("apple/swift", swift.title)
        assertEquals(now.toDouble(), swift.lastVisit, 0.0)
        assertEquals(listOf("https://github.com/apple/swift", "https://linear.app/ARD-1"), merged.history.map { it.url })
        assertEquals(listOf("https://forums.swift.org/"), merged.bookmarks.map { it.url })
        assertEquals(local, OmniboxCandidates.merge(emptyList(), local, null).history)
    }
}

class ClosingCore : CoreScript, AutoCloseable {
    val threads = ArrayList<String>()
    var closes = 0

    override fun call(function: String, arguments: List<String>): String {
        threads.add(Thread.currentThread().name)
        return "null"
    }

    override fun close() {
        threads.add(Thread.currentThread().name)
        closes++
    }
}

class OmniboxCloseTest {
    @Test
    fun closeShutsTheScriptOnItsOwnThreadOnceAndLaterCallsAnswerEmpty() = kotlinx.coroutines.runBlocking {
        val core = ClosingCore()
        var created = 0
        val omnibox = Omnibox({ created++; core })
        omnibox.warmUp()
        omnibox.close()
        omnibox.close()
        assertEquals(1, core.closes)
        assertEquals(2, core.threads.size)
        assertTrue(core.threads.all { it.startsWith("ArdiaOmnibox") })
        assertTrue(omnibox.isClosed)
        assertEquals(OmniboxResult("git", emptyList(), ""), omnibox.suggest("git"))
        assertNull(omnibox.resolve("apple.com"))
        assertEquals(1, created)
    }

    @Test
    fun closingBeforeTheScriptExistsNeverCreatesIt() = kotlinx.coroutines.runBlocking {
        var created = 0
        val omnibox = Omnibox({ created++; ClosingCore() })
        omnibox.close()
        assertTrue(omnibox.engines().isEmpty())
        assertEquals(0, created)
    }
}
