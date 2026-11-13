package com.ardia.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TabPoliciesTest {
    @Test
    fun intervalsKeepTheIphoneRawValuesAndTitles() {
        assertEquals(listOf("oneHour", "fourHours", "twelveHours", "day", "threeDays", "week", "never"), AutoArchiveInterval.entries.map { it.raw })
        assertEquals(AutoArchiveInterval.DAY, AutoArchiveInterval.standard)
        assertEquals(listOf("After 1 hour", "After 4 hours", "After 12 hours", "After 1 day", "After 3 days", "After 7 days", "Never"), AutoArchiveInterval.entries.map { it.title })
        assertNull(AutoArchiveInterval.of("fortnight"))
    }

    @Test
    fun aTabBeingViewedIsNeverDue() {
        assertFalse(AutoArchivePolicy.isDue(0, 10 * DAY_MS, AutoArchiveInterval.DAY, isBeingViewed = true))
        assertTrue(AutoArchivePolicy.isDue(0, 10 * DAY_MS, AutoArchiveInterval.DAY, isBeingViewed = false))
    }

    @Test
    fun onlyWebAddressesSync() {
        assertTrue(BrowserUrl.isSyncable("HTTPS://example.com"))
        assertTrue(BrowserUrl.isSyncable("http://example.com"))
        assertFalse(BrowserUrl.isSyncable("ardia://inbox"))
        assertFalse(BrowserUrl.isSyncable("javascript:alert(1)"))
    }

    @Test
    fun hostsDropWwwAndKeepUnicode() {
        assertEquals("example.com", BrowserUrl.host("https://WWW.Example.com/path"))
        assertEquals("bücher.de", BrowserUrl.host("https://bücher.de/a b"))
        assertNull(BrowserUrl.host("not a url"))
        assertEquals("not a url", BrowserUrl.displayHost("not a url"))
    }

    @Test
    fun searchUrlsEncodeLikeEncodeUriComponentAndAppendWithoutAPlaceholder() {
        assertEquals("https://x.example/?q=caf%C3%A9%20%E2%9C%93", BrowserUrl.searchUrl("https://x.example/?q=%s", " café ✓ "))
        assertEquals("https://x.example/search/a-b_c.d!~*'()", BrowserUrl.searchUrl("https://x.example/search/", "a-b_c.d!~*'()"))
    }

    @Test
    fun positionsSplitTheGapUntilItIsTooSmall() {
        assertEquals(0.0, TabPositions.between(null, null)!!, 0.0)
        assertEquals(1024.0 + 5, TabPositions.between(5.0, null)!!, 0.0)
        assertEquals(5.0 - 1024.0, TabPositions.between(null, 5.0)!!, 0.0)
        assertEquals(1.5, TabPositions.between(1.0, 2.0)!!, 0.0)
        assertNull(TabPositions.between(1.0, 1.0 + 1e-7))
    }

    @Test
    fun searchTemplatesPreferTheMacThenTheLocalChoice() {
        val custom = SearchChoice("c1", null, listOf(CustomSearchEngine("c1", "Docs", "docs", "https://docs.example/?q=%s")))
        assertEquals("https://docs.example/?q=%s", SearchTemplates.template(custom, "bing"))
        assertEquals("https://own.example/%s", SearchTemplates.template(SearchChoice("custom", "https://own.example/%s"), "bing"))
        assertEquals("https://kagi.com/search?q=%s", SearchTemplates.template(SearchChoice("kagi"), "bing"))
        assertEquals("https://www.bing.com/search?q=%s", SearchTemplates.template(SearchChoice("missing"), "bing"))
        assertEquals("https://www.google.com/search?q=%s", SearchTemplates.template(null, "nothing"))
        assertEquals("Docs", SearchTemplates.name(custom))
        assertEquals("Custom", SearchTemplates.name(SearchChoice("custom")))
        assertEquals("Brave Search", SearchTemplates.name("brave"))
        assertEquals("Mojeek", SearchTemplates.name("mojeek", emptyList()))
    }
}
