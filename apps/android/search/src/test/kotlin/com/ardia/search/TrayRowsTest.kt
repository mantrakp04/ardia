package com.ardia.search

import com.ardia.store.SearchSuggestion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrayRowsTest {
    private val query = SearchSuggestion.query("paris olympics")
    private val page = SearchSuggestion("p:https://a.com", SearchSuggestion.Kind.History, "A", "a.com", "https://a.com", "A")
    private val calc = SearchSuggestion("c:2+2", SearchSuggestion.Kind.Calculation, "= 4", "2+2", "https://s/?q=2+2", "2+2", copyValue = "4")

    @Test
    fun thePasteRowLeadsOnlyWhileTheFieldIsEmpty() {
        val idle = TrayRows.build(listOf(query), "", ClipboardOffer.Link)
        assertEquals(TrayRow.Paste(ClipboardOffer.Link), idle.first())
        assertEquals(2, idle.size)
        val typed = TrayRows.build(listOf(query), "par", ClipboardOffer.Link)
        assertEquals(listOf<TrayRow>(TrayRow.Suggested(query)), typed)
        assertEquals(1, TrayRows.build(listOf(query), "", null).size)
    }

    @Test
    fun onlySearchesCanBeRefined() {
        assertTrue(TrayRows.isRefinable(TrayRow.Suggested(query)))
        assertFalse(TrayRows.isRefinable(TrayRow.Suggested(page)))
        assertFalse(TrayRows.isRefinable(TrayRow.Paste(ClipboardOffer.Text)))
        assertEquals("paris olympics ", TrayRows.refinedText(query))
    }

    @Test
    fun theTypedPrefixIsDimmedOnlyWhenTheTitleStartsWithIt() {
        assertEquals(3, TrayRows.queryPrefixLength("paris olympics", "Par"))
        assertEquals(0, TrayRows.queryPrefixLength("paris olympics", "oly"))
        assertEquals(0, TrayRows.queryPrefixLength("paris", "paris"))
        assertEquals(0, TrayRows.queryPrefixLength("paris", "  "))
    }

    @Test
    fun aCalculationStaysInSearchEverythingElseLeaves() {
        assertFalse(TrayRows.leavesSearch(calc))
        assertTrue(TrayRows.leavesSearch(query))
        assertTrue(TrayRows.leavesSearch(page))
    }
}
