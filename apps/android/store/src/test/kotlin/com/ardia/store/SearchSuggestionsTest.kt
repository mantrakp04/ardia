package com.ardia.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchSuggestionsTest {
    private val mac = SyncedBrowsing(
        deviceTabs = listOf(
            SyncedBrowsing.DeviceTabs("phone", "This Phone", isMac = false, isCurrent = true, tabs = listOf(SyncedBrowsing.RemoteTab("https://phone.example/", "Phone"))),
            SyncedBrowsing.DeviceTabs(
                "mac", "MacBook Pro", isMac = true, isCurrent = false,
                tabs = listOf(
                    SyncedBrowsing.RemoteTab("https://linear.app/ARD-1", "ARD-1"),
                    SyncedBrowsing.RemoteTab("ardia://inbox", "Inbox"),
                    SyncedBrowsing.RemoteTab("https://b.example/", ""),
                    SyncedBrowsing.RemoteTab("https://c.example/", "C"),
                    SyncedBrowsing.RemoteTab("https://d.example/", "D"),
                ),
            ),
        ),
    )

    private fun page(url: String, title: String = "", tabId: String? = null, bookmarked: Boolean = false, visited: Boolean = false) =
        OmniboxSuggestion.Page(url, title, null, tabId, bookmarked, visited)

    @Test
    fun theTypedQueryComesSecondWhenTheResultIsCurrentAndRowsAreLabelledBySource() {
        val result = OmniboxResult(
            "git",
            listOf(
                page("https://github.com/", "GitHub", visited = true),
                page("https://github.com/", "GitHub", visited = true),
                page("https://linear.app/ARD-1", "ARD-1 git"),
                page("https://gitlab.com/", "", bookmarked = true),
                page("https://git-scm.com/", "Git", tabId = "T1"),
                OmniboxSuggestion.Search("git rebase", "https://www.google.com/search?q=git%20rebase", "Google", true, false),
            ),
            "hub.com",
        )
        val rows = SearchSuggestions.rows("git", result, mac, emptyList())
        assertEquals(listOf("p:https://github.com/", "q:git", "p:https://linear.app/ARD-1", "p:https://gitlab.com/", "p:https://git-scm.com/", "q:https://www.google.com/search?q=git%20rebase"), rows.map { it.id })
        assertEquals(SearchSuggestion.Kind.History, rows[0].kind)
        assertEquals(SearchSuggestion.Kind.RemoteTab("MacBook Pro"), rows[2].kind)
        assertEquals(SearchSuggestion.Kind.Bookmark, rows[3].kind)
        assertEquals("gitlab.com", rows[3].title)
        assertEquals(SearchSuggestion.Kind.OpenTab("T1"), rows[4].kind)
        assertTrue(rows[0].showsFavicon)
        assertTrue(!rows[1].showsFavicon)
    }

    @Test
    fun aStaleResultKeepsOnlyRowsThatStillMatchAndPutsTheTypedQueryFirstWhenMissing() {
        val result = OmniboxResult(
            "gi",
            listOf(
                page("https://github.com/", "GitHub"),
                page("https://gitlab.com/", "GitLab"),
                OmniboxSuggestion.Search("gi", "https://www.google.com/search?q=gi", "Google", false, false),
                OmniboxSuggestion.Search("gitl", "https://www.google.com/search?q=gitl", "Google", false, false),
            ),
            "",
        )
        val rows = SearchSuggestions.rows("gitl", result, null, emptyList())
        assertEquals(listOf("p:https://gitlab.com/", "q:https://www.google.com/search?q=gitl"), rows.map { it.id })
        val withoutQuery = SearchSuggestions.rows("gitla", result, null, emptyList())
        assertEquals(listOf("q:gitla", "p:https://gitlab.com/"), withoutQuery.map { it.id })
    }

    @Test
    fun rowsStopAtNineWithTheTypedQueryKept() {
        val result = OmniboxResult("a", (0 until 12).map { page("https://a$it.example/", "a $it") }, "")
        val rows = SearchSuggestions.rows("a", result, null, emptyList())
        assertEquals(SearchSuggestions.ROW_LIMIT, rows.size)
        assertEquals("q:a", rows[1].id)
    }

    @Test
    fun bangsAndCalculationsReadAsTheirOwnRows() {
        val result = OmniboxResult(
            "12*3",
            listOf(
                OmniboxSuggestion.Calculation("12*3", "36", "https://www.google.com/search?q=12*3"),
                OmniboxSuggestion.Search("cats", "https://wikipedia.org/?search=cats", "Wikipedia", false, true),
            ),
            "",
        )
        val rows = SearchSuggestions.rows("12*3", result, null, emptyList())
        assertEquals("= 36", rows[0].title)
        assertEquals("36", rows[0].copyValue)
        assertEquals("Search Wikipedia", rows.first { it.title == "cats" }.detail)
    }

    @Test
    fun theEmptyFieldShowsRecentSearchesThenTheMacsTabs() {
        val rows = SearchSuggestions.rows("  ", OmniboxResult.empty, mac, listOf("sintra", "pancakes"))
        assertEquals(listOf("q:sintra", "q:pancakes", "r:https://linear.app/ARD-1", "r:https://b.example/", "r:https://c.example/"), rows.map { it.id })
        assertEquals("https://b.example/", rows[3].title)
        assertEquals("b.example", rows[3].detail)
        assertTrue(SearchSuggestions.rows("", OmniboxResult.empty, null, emptyList()).isEmpty())
    }

    @Test
    fun typedTextBecomesAnAddressOrASearch() {
        assertEquals(SearchInput.Destination.Url("https://apple.com"), SearchInput.resolve(" apple.com "))
        assertEquals(SearchInput.Destination.Url("http://localhost:3000/x"), SearchInput.resolve("localhost:3000/x"))
        assertEquals(SearchInput.Destination.Url("http://192.168.1.4"), SearchInput.resolve("192.168.1.4"))
        assertEquals(SearchInput.Destination.Url("https://example.com/a%20b"), SearchInput.resolve("https://example.com/a b"))
        assertEquals(SearchInput.Destination.Url("https://xn--bcher-kva.de"), SearchInput.resolve("xn--bcher-kva.de"))
        assertEquals(SearchInput.Destination.Search("how tall is everest"), SearchInput.resolve("how tall is everest"))
        assertEquals(SearchInput.Destination.Search("v1.2"), SearchInput.resolve("v1.2"))
        assertEquals(SearchInput.Destination.Search("about:blank"), SearchInput.resolve("about:blank"))
        assertNull(SearchInput.resolve("   "))
    }
}
