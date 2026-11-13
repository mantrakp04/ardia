package com.ardia.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RecentSearchesTest {
    @Test
    fun readsTheQueryFromASearchEngineAddress() {
        assertEquals("big nate", RecentSearches.query("https://www.google.com/search?q=big+nate&hl=en"))
        assertEquals("sintra", RecentSearches.query("https://duckduckgo.com/?q=sintra"))
        assertEquals("pastéis de nata", RecentSearches.query("https://www.google.com/search?q=past%C3%A9is+de+nata"))
        assertNull(RecentSearches.query("https://www.youtube.com/results?search_query=dogs"))
    }

    @Test
    fun ignoresPagesThatAreNotSearches() {
        assertNull(RecentSearches.query("https://en.wikipedia.org/wiki/Lisbon"))
        assertNull(RecentSearches.query("https://www.google.com/maps"))
        assertNull(RecentSearches.query("https://notgoogle.com/search?q=x"))
        assertNull(RecentSearches.query("https://www.google.com/search?q=+"))
    }

    @Test
    fun keepsTheNewestOfEachQueryOnceUpToTheLimit() {
        val urls = listOf(
            "https://www.google.com/search?q=magnesium",
            "https://en.wikipedia.org/wiki/Sintra",
            "https://www.google.com/search?q=Magnesium",
            "https://www.bing.com/search?q=big+nate",
            "https://www.google.com/search?q=pancakes",
        )
        assertEquals(listOf("magnesium", "big nate"), RecentSearches.queries(urls, 2))
        assertEquals(listOf("magnesium", "big nate", "pancakes"), RecentSearches.queries(urls, 9))
    }
}
