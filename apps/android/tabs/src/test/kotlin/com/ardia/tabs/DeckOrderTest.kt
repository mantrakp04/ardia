package com.ardia.tabs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeckOrderTest {
    @Test
    fun reconcileKeepsTheDeckOrderAndAppendsNewTabsAtTheEnd() {
        val result = DeckOrder.reconcile(listOf("a", "b", "c"), listOf("c", "a", "b", "d"), scroll = 1.0)!!
        assertEquals(listOf("a", "b", "c", "d"), result.order)
        assertEquals(1.0, result.scroll, 0.0)
    }

    @Test
    fun reconcileKeepsTheFocusedCardInFocusWhenAnEarlierTabCloses() {
        val result = DeckOrder.reconcile(listOf("a", "b", "c", "d"), listOf("b", "c", "d"), scroll = 2.0)!!
        assertEquals(listOf("b", "c", "d"), result.order)
        assertEquals(1.0, result.scroll, 0.0)
    }

    @Test
    fun reconcileClampsTheScrollWhenTheFocusedCardIsGone() {
        val result = DeckOrder.reconcile(listOf("a", "b", "c"), listOf("a", "b"), scroll = 2.0)!!
        assertEquals(listOf("a", "b"), result.order)
        assertEquals(1.0, result.scroll, 0.0)
    }

    @Test
    fun reconcileReportsNothingWhenOnlyTheSelectionMoved() {
        assertNull(DeckOrder.reconcile(listOf("a", "b", "c"), listOf("c", "b", "a"), scroll = 0.0))
    }

    @Test
    fun theDeckOpensOnTheSecondToLastCardOrTheTabYouCameFrom() {
        assertEquals(3.0, DeckOrder.initialScroll(5), 0.0)
        assertEquals(0.0, DeckOrder.initialScroll(1), 0.0)
        assertEquals(3.0, DeckOrder.openingScroll(index = 4, count = 5), 0.0)
        assertEquals(2.0, DeckOrder.openingScroll(index = 2, count = 5), 0.0)
        assertEquals(0.0, DeckOrder.openingScroll(index = 0, count = 1), 0.0)
        assertEquals(1.0, DeckOrder.handoffScroll(2), 0.0)
    }

    @Test
    fun aSlotShiftKeepsEachCardWhereItWasOnScreen() {
        val oldIndex = 1
        val oldScroll = 3.0
        val newIndex = 1
        val newScroll = 2.0
        val shift = DeckOrder.slotShift(oldIndex, 0.0, oldScroll, newIndex, newScroll)
        assertEquals(oldIndex - oldScroll, newIndex + shift - newScroll, 1e-9)
    }

    @Test
    fun roundingMatchesTheIphoneForHalves() {
        assertEquals(3, DeckOrder.rounded(2.5))
        assertEquals(-3, DeckOrder.rounded(-2.5))
        assertEquals(2, DeckOrder.focusedIndex(7.0, 3))
        assertEquals(0, DeckOrder.focusedIndex(-0.4, 3))
        assertNull(DeckOrder.focusedId(emptyList(), 0.0))
    }
}
