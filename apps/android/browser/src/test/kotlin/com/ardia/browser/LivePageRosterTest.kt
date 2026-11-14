package com.ardia.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePageRosterTest {
    private class FakePage : DiscardablePage {
        override var isLive = false
        var madeLive = 0
        var discarded = 0

        override fun makeLive() {
            isLive = true
            madeLive += 1
        }

        override fun discard() {
            isLive = false
            discarded += 1
        }
    }

    private fun roster(limit: Int, count: Int): Pair<LivePageRoster<FakePage>, List<FakePage>> {
        val roster = LivePageRoster<FakePage>(limit)
        val pages = List(count) { FakePage().also { page -> roster.register(page, "t$it") } }
        return roster to pages
    }

    @Test
    fun registeringDoesNotMakeAPageLive() {
        val (roster, pages) = roster(limit = 2, count = 3)
        assertTrue(pages.none { it.isLive })
        assertTrue(roster.liveIds.isEmpty())
    }

    @Test
    fun activatingPastTheLimitDropsTheLeastRecentPage() {
        val (roster, pages) = roster(limit = 2, count = 3)
        roster.activate("t0")
        roster.activate("t1")
        roster.activate("t2")
        assertEquals(listOf("t1", "t2"), roster.liveIds)
        assertFalse(pages[0].isLive)
        assertEquals(1, pages[0].discarded)
    }

    @Test
    fun reactivatingKeepsAPageAndRefreshesItsRecency() {
        val (roster, pages) = roster(limit = 2, count = 3)
        roster.activate("t0")
        roster.activate("t1")
        roster.activate("t0")
        roster.activate("t2")
        assertEquals(listOf("t0", "t2"), roster.liveIds)
        assertEquals(1, pages[0].madeLive)
        assertEquals(1, pages[1].discarded)
    }

    @Test
    fun aDroppedPageComesBackLiveWhenActivated() {
        val (roster, pages) = roster(limit = 1, count = 2)
        roster.activate("t0")
        roster.activate("t1")
        roster.activate("t0")
        assertTrue(pages[0].isLive)
        assertEquals(2, pages[0].madeLive)
        assertEquals(listOf("t0"), roster.liveIds)
    }

    @Test
    fun removingDiscardsAndForgetsThePage() {
        val (roster, pages) = roster(limit = 3, count = 2)
        roster.activate("t0")
        assertTrue(roster.remove("t0") === pages[0])
        assertFalse(pages[0].isLive)
        assertNull(roster.page("t0"))
        assertNull(roster.remove("t0"))
    }

    @Test
    fun discardAllKeepsOnlyTheChosenPage() {
        val (roster, pages) = roster(limit = 5, count = 3)
        pages.indices.forEach { roster.activate("t$it") }
        roster.discardAll(except = "t1")
        assertEquals(listOf("t1"), roster.liveIds)
        assertEquals("t1", roster.mostRecent)
        assertTrue(roster.page("t0") === pages[0])
        assertFalse(pages[2].isLive)
    }

    @Test
    fun aLimitBelowOneStillKeepsTheActivePage() {
        val (roster, pages) = roster(limit = 0, count = 2)
        roster.activate("t0")
        roster.activate("t1")
        assertEquals(1, roster.limit)
        assertTrue(pages[1].isLive)
        assertFalse(pages[0].isLive)
    }
}
