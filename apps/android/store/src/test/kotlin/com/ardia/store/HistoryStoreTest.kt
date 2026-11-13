package com.ardia.store

import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class HistoryStoreTest {
    private val noon = LocalDateTime.of(2027, 3, 10, 12, 0).toInstant(ZoneOffset.UTC).toEpochMilli()

    private fun seeded(): StoreFixture {
        val fixture = StoreFixture()
        fixture.clock.now = noon
        val ages = mapOf("https://minutes.example/" to 10 * 60_000L, "https://morning.example/" to 5 * HOUR_MS, "https://yesterday.example/" to DAY_MS, "https://week.example/" to 7 * DAY_MS)
        for ((url, age) in ages) fixture.store.recordVisit(url, "", VisitTransition.TYPED, null, noon - age)
        return fixture
    }

    @Test
    fun clearRangesMatchTheClearBrowsingDataPage(): Unit = runBlocking {
        val expectations = mapOf(
            ClearRange.LAST_HOUR to listOf("https://morning.example/", "https://yesterday.example/", "https://week.example/"),
            ClearRange.TODAY to listOf("https://yesterday.example/", "https://week.example/"),
            ClearRange.TODAY_AND_YESTERDAY to listOf("https://week.example/"),
            ClearRange.ALL_TIME to emptyList(),
        )
        for ((range, left) in expectations) {
            val fixture = seeded()
            fixture.history.clear(range, ZoneOffset.UTC)
            assertEquals(range.name, left, fixture.history.recent().map { it.url })
        }
        assertNull(ClearRange.ALL_TIME.since(noon))
    }

    @Test
    fun searchFindsTitlesAndAddressesNewestFirstAndDeleteRemovesThem(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        store.recordVisit("https://docs.example/a", "Kotlin coroutines", VisitTransition.LINK)
        fixture.clock.advance(1_000)
        val second = store.recordVisit("https://kotlinlang.org/", "Home", VisitTransition.TYPED)!!
        fixture.clock.advance(1_000)
        store.recordVisit("https://other.example/", "100% off_sale", VisitTransition.TYPED)
        assertEquals(listOf("https://kotlinlang.org/", "https://docs.example/a"), fixture.history.search("KOTLIN").map { it.url })
        assertEquals(listOf("https://other.example/"), fixture.history.search("100%").map { it.url })
        assertEquals(listOf("https://other.example/"), fixture.history.search("f_s").map { it.url })
        assertTrue(fixture.history.search("o_e").isEmpty())
        fixture.history.delete(setOf(second.id))
        assertEquals(listOf("https://docs.example/a"), fixture.history.search("kotlin").map { it.url })
        fixture.history.deleteAll("https://docs.example/a")
        assertTrue(fixture.history.search("kotlin").isEmpty())
    }

    @Test
    fun summaryGroupsVisitsByAddressNewestFirstAndKeepsTheFirstTitle(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        store.recordVisit("https://a.example/", "Old A", VisitTransition.LINK)
        fixture.clock.advance(1_000)
        store.recordVisit("https://b.example/", "B", VisitTransition.LINK)
        fixture.clock.advance(1_000)
        store.recordVisit("https://a.example/", "", VisitTransition.LINK)
        val summary = fixture.history.summary()
        assertEquals(listOf("https://a.example/", "https://b.example/"), summary.map { it.url })
        assertEquals(2, summary.first().visits)
        assertEquals("Old A", summary.first().title)
        assertEquals(fixture.clock.now.toDouble(), summary.first().lastVisit, 0.0)
        assertEquals(1, fixture.history.summary(limit = 1).size)
    }

    @Test
    fun recentSearchesComeFromSearchEngineVisitsOnly(): Unit = runBlocking {
        val fixture = StoreFixture()
        for (url in listOf("https://www.google.com/search?q=pancakes", "https://en.wikipedia.org/wiki/Sintra", "https://www.bing.com/search?q=big+nate", "https://www.google.com/search?q=Magnesium")) {
            fixture.clock.advance(1_000)
            fixture.store.recordVisit(url, "", VisitTransition.TYPED)
        }
        assertEquals(listOf("Magnesium", "big nate", "pancakes"), fixture.history.recentSearches())
        assertEquals(listOf("Magnesium"), fixture.history.recentSearches(limit = 1))
    }

    @Test
    fun amendKeepsTheOldAddressForAnUnsyncableOneAndTheOldTitleForAnEmptyOne(): Unit = runBlocking {
        val fixture = StoreFixture()
        val visit = fixture.store.recordVisit("https://a.example/", "A", VisitTransition.LINK)!!
        val amended = fixture.store.amend(visit, url = "about:blank", title = "")
        assertEquals("https://a.example/", amended.url)
        assertEquals("A", amended.title)
        fixture.store.amend(amended, url = "https://a.example/landed", title = "Landed")
        assertEquals(listOf("https://a.example/landed" to "Landed"), fixture.history.recent().map { it.url to it.title })
    }

    @Test
    fun revisionMovesOnEveryHistoryChange(): Unit = runBlocking {
        val fixture = StoreFixture()
        val start = fixture.history.revision.value
        fixture.store.recordVisit("https://a.example/", "", VisitTransition.LINK)
        fixture.store.clearHistory()
        fixture.history.removeVisits(setOf("https://a.example/"), null)
        assertEquals(start + 3, fixture.history.revision.value)
    }
}
