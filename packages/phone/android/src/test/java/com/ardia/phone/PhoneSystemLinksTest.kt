package com.ardia.phone

import android.app.SearchManager
import android.content.Intent
import android.net.Uri
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhoneSystemLinksTest {
    private fun view(uri: String) = Intent(Intent.ACTION_VIEW, Uri.parse(uri))

    @After
    fun forget() = PhoneSystemLinks.forgetForTests()

    @Test
    fun webLinksFromOtherAppsOpenAsWebLinks() {
        assertEquals(mapOf("kind" to "open", "url" to "https://example.com/a?b=1", "source" to "web"), PhoneSystemLinks.link(view("https://example.com/a?b=1")))
        assertEquals("web", PhoneSystemLinks.link(view("http://example.com/"))?.get("source"))
        assertNull(PhoneSystemLinks.link(view("ftp://example.com/")))
        assertNull(PhoneSystemLinks.link(view("javascript:alert(1)")))
        assertNull(PhoneSystemLinks.link(Intent(Intent.ACTION_VIEW)))
    }

    @Test
    fun ardiaLinksBecomeTheirKindsFromWidgetsAndShortcuts() {
        assertEquals(mapOf("kind" to "search", "source" to "system"), PhoneSystemLinks.link(view("ardia://search")))
        assertEquals(mapOf("kind" to "search", "query" to "red pandas", "source" to "system"), PhoneSystemLinks.link(view("ardia://search?q=red%20pandas")))
        assertEquals(mapOf("kind" to "voiceSearch", "source" to "system"), PhoneSystemLinks.link(view("ardia://voice")))
        assertEquals(mapOf("kind" to "incognito", "source" to "system"), PhoneSystemLinks.link(view("ardia://incognito")))
        assertEquals(mapOf("kind" to "macTabs", "source" to "system"), PhoneSystemLinks.link(view("ardia://mac-tabs")))
        assertEquals(mapOf("kind" to "tab", "id" to "t-1", "source" to "system"), PhoneSystemLinks.link(view("ardia://tab/t-1")))
        assertEquals(mapOf("kind" to "open", "url" to "https://example.com/", "source" to "system"), PhoneSystemLinks.link(view("ardia://open?url=https%3A%2F%2Fexample.com%2F")))
        assertEquals(mapOf("kind" to "inbox", "source" to "system"), PhoneSystemLinks.link(view("ardia://inbox")))
        assertNull(PhoneSystemLinks.link(view("ardia://open?url=javascript%3Aalert(1)")))
        assertNull(PhoneSystemLinks.link(view("ardia://nothing")))
        val shortcut = view("ardia://incognito").putExtra(PhoneSystemLinks.SOURCE_EXTRA, "shortcut")
        assertEquals(mapOf("kind" to "incognito", "source" to "shortcut"), PhoneSystemLinks.link(shortcut))
        val spoofed = view("ardia://incognito").putExtra(PhoneSystemLinks.SOURCE_EXTRA, "web")
        assertEquals("system", PhoneSystemLinks.link(spoofed)?.get("source"))
    }

    @Test
    fun webSearchAndSelectedTextSearchOrOpenAnAddress() {
        val search = Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, "  red pandas  ")
        assertEquals(mapOf("kind" to "search", "query" to "red pandas", "source" to "intent"), PhoneSystemLinks.link(search))
        val address = Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, "https://example.com/")
        assertEquals(mapOf("kind" to "open", "url" to "https://example.com/", "source" to "intent"), PhoneSystemLinks.link(address))
        val bare = Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, "example.com")
        assertEquals(mapOf("kind" to "search", "query" to "example.com", "source" to "intent"), PhoneSystemLinks.link(bare))
        assertEquals(mapOf("kind" to "search", "source" to "intent"), PhoneSystemLinks.link(Intent(Intent.ACTION_WEB_SEARCH)))
        val selected = Intent(Intent.ACTION_PROCESS_TEXT).putExtra(Intent.EXTRA_PROCESS_TEXT, "a selected phrase")
        assertEquals(mapOf("kind" to "search", "query" to "a selected phrase", "source" to "intent"), PhoneSystemLinks.link(selected))
        assertNull(PhoneSystemLinks.link(Intent(Intent.ACTION_PROCESS_TEXT).putExtra(Intent.EXTRA_PROCESS_TEXT, "   ")))
    }

    @Test
    fun sharedTextOpensItsFirstLinkOrSearchesTheText() {
        fun send(text: String?) = Intent(Intent.ACTION_SEND).setType("text/plain").apply { if (text != null) putExtra(Intent.EXTRA_TEXT, text) }
        assertEquals(mapOf("kind" to "open", "url" to "https://example.com/story", "source" to "share"), PhoneSystemLinks.link(send("Read this: https://example.com/story.")))
        assertEquals(mapOf("kind" to "search", "query" to "just some words", "source" to "share"), PhoneSystemLinks.link(send("just some words")))
        assertEquals(mapOf("kind" to "search", "query" to "example.com", "source" to "share"), PhoneSystemLinks.link(send("example.com")))
        assertNull(PhoneSystemLinks.link(send(null)))
        assertNull(PhoneSystemLinks.link(send("  ")))
    }

    @Test
    fun theLauncherAndUnknownIntentsAreNotLinks() {
        assertNull(PhoneSystemLinks.link(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)))
        assertNull(PhoneSystemLinks.link(null))
    }

    @Test
    fun aLinkWaitsForTheAppOnceAndIsNotDeliveredAgainOnRecreateOrFromRecents() {
        val intent = view("https://example.com/")
        PhoneSystemLinks.receive(intent)
        PhoneSystemLinks.receive(intent)
        assertEquals("https://example.com/", PhoneSystemLinks.takeInitial()?.get("url"))
        assertNull(PhoneSystemLinks.takeInitial())
        PhoneSystemLinks.receive(view("https://example.org/").addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY))
        PhoneSystemLinks.receive(view("https://example.net/"), restored = true)
        assertNull(PhoneSystemLinks.takeInitial())
    }

    @Test
    fun aListeningAppGetsLinksAsEventsAndAnOldListenerLeavingKeepsTheNewOne() {
        val first = ArrayList<Map<String, Any?>>()
        val second = ArrayList<Map<String, Any?>>()
        PhoneSystemLinks.receive(view("https://queued.example/"))
        val old = PhoneSystemLinks.listen { first += it }
        assertEquals(listOf("https://queued.example/"), first.map { it["url"] })
        val fresh = PhoneSystemLinks.listen { second += it }
        PhoneSystemLinks.stopListening(old)
        PhoneSystemLinks.receive(view("https://later.example/"))
        assertEquals(listOf("https://later.example/"), second.map { it["url"] })
        assertEquals(1, first.size)
        PhoneSystemLinks.stopListening(fresh)
    }
}
