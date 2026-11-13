package com.ardia.store

import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteDatabaseLockedException
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteFullException
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class StoreWriterTest {
    @Test
    fun aThousandFailedEditsToOneTabKeepOneEntryAndTheLastOneWins(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        fixture.database.failing = true
        val tab = fixture.open("https://a.example/")
        repeat(1_000) { store.update(tab.id, title = "Title $it") }
        assertTrue(fixture.database.failedCommits >= 1_000)
        assertEquals(1, store.writer.retainedSegments)
        assertEquals(1, store.writer.retainedEntries)
        fixture.database.failing = false
        assertTrue(store.flush())
        assertEquals(0, store.writer.retainedEntries)
        assertEquals(listOf("Title 999"), fixture.relaunch().openTabs.map { it.title })
    }

    @Test
    fun pendingVisitsAreCappedKeepingTheOldestAndTheLossIsReported(): Unit = runBlocking {
        val fixture = StoreFixture()
        fixture.database.failing = true
        fixture.database.failBeforeWork = true
        repeat(StoreWriter.MAX_PENDING_VISITS + 3) { fixture.store.recordVisit("https://v$it.example/", "", VisitTransition.LINK) }
        assertEquals(3, fixture.store.droppedVisits.value)
        assertEquals(StoreWriter.MAX_PENDING_VISITS, fixture.store.writer.retainedEntries)
        fixture.database.failing = false
        assertTrue(fixture.store.flush())
        assertEquals(StoreWriter.MAX_PENDING_VISITS, fixture.database.visitCount())
        assertEquals("https://v0.example/", fixture.history.recent(limit = 1_000_000).last().url)
        assertTrue(fixture.store.writeFailure.value is StoreWriteException)
        fixture.store.acknowledgeWriteProblems()
        assertNull(fixture.store.writeFailure.value)
    }

    @Test
    fun aPoisonedEntryIsQuarantinedAndReportedAndEverythingElseCommits(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        fixture.database.poisonedUrls += "https://bad.example/"
        val bad = fixture.open("https://bad.example/")
        val good = fixture.open("https://good.example/")
        store.recordVisit("https://bad.example/", "Bad", VisitTransition.TYPED)
        store.recordVisit("https://good.example/", "Good", VisitTransition.TYPED)
        assertTrue(store.flush())
        assertFalse(store.hasUnsavedChanges)
        assertEquals(listOf(QuarantinedWrite.Kind.TAB, QuarantinedWrite.Kind.VISIT), store.quarantinedWrites.value.map { it.kind }.distinct().sorted())
        assertTrue(store.quarantinedWrites.value.any { it.key == bad.id && it.error.startsWith("SQLiteConstraintException") })
        assertTrue(store.writeFailure.value is StoreWriteException)
        assertEquals(listOf(good.id), fixture.relaunch().openTabs.map { it.id })
        assertEquals(listOf("https://good.example/"), fixture.history.recent().map { it.url })
        val later = fixture.open("https://later.example/")
        assertTrue(fixture.store.flush())
        assertTrue(fixture.database.tab(later.id) != null)
    }

    @Test
    fun aClearAndAVisitReplayInOrderAfterAFailedDrain(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        fixture.database.failing = true
        val before = store.recordVisit("https://before.example/", "Before", VisitTransition.TYPED)!!
        store.clearHistory()
        store.recordVisit("https://after.example/", "After", VisitTransition.TYPED)
        store.amend(before, title = "Loaded late")
        repeat(50) { store.clearHistory() }
        store.recordVisit("https://last.example/", "Last", VisitTransition.TYPED)
        assertFalse(store.flush())
        assertEquals(2, store.writer.retainedSegments)
        fixture.database.failing = false
        assertTrue(store.flush())
        assertEquals(listOf("https://last.example/"), fixture.history.recent().map { it.url })
    }

    @Test
    fun tabChangesKeepTheirOrderAroundAClearedArchive(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        fixture.open("https://stays.example/")
        fixture.database.failing = true
        val early = fixture.open("https://early.example/")
        store.close(early.id)
        store.clearArchive()
        val late = fixture.open("https://late.example/")
        store.close(late.id)
        repeat(100) { store.update(late.id, title = "Late $it") }
        assertFalse(store.flush())
        fixture.database.failing = false
        assertTrue(store.flush())
        assertNull(fixture.database.tab(early.id))
        assertEquals("Late 99", fixture.database.tab(late.id)?.title)
        assertTrue(fixture.database.tab(late.id)!!.isArchived)
    }

    @Test
    fun receiveIsFalseOnlyWhenItsOwnTabDidNotCommit() {
        val fixture = StoreFixture()
        fixture.database.poisonedUrls += "https://bad.example/"
        fixture.open("https://bad.example/other")
        val bad = IncomingTab("send:bad", "https://bad.example/", "Bad", "Mac", fixture.clock.now, "p")
        val good = IncomingTab("send:good", "https://good.example/", "Good", "Mac", fixture.clock.now, "p")
        assertFalse(fixture.store.receive(listOf(bad)))
        assertFalse(fixture.store.receive(listOf(bad)))
        assertEquals(1, fixture.store.openTabs.count { it.url == "https://bad.example/" })
        assertTrue(fixture.store.receive(listOf(good)))
        assertFalse(fixture.store.receive(listOf(good, bad)))
        fixture.database.failing = true
        val other = IncomingTab("send:other", "https://other.example/", "Other", "Mac", fixture.clock.now, "p")
        assertFalse(fixture.store.receive(listOf(other)))
        fixture.database.failing = false
        assertTrue(fixture.store.receive(listOf(other)))
    }

    @Test
    fun onlyErrorsThatRetryingCanFixAreRetried() {
        assertTrue(StoreWriter.isRetryable(SQLiteFullException()))
        assertTrue(StoreWriter.isRetryable(SQLiteDatabaseLockedException()))
        assertTrue(StoreWriter.isRetryable(SQLiteDiskIOException()))
        assertTrue(StoreWriter.isRetryable(IOException()))
        assertFalse(StoreWriter.isRetryable(SQLiteConstraintException()))
        assertFalse(StoreWriter.isRetryable(SQLiteDatabaseCorruptException()))
        assertFalse(StoreWriter.isRetryable(IllegalStateException()))
    }
}

@RunWith(RobolectricTestRunner::class)
class VisitCapTest {
    @Test
    fun recordingAndAmendingPastTheCapNeverGrowsTheLogAndEveryDropIsCounted(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        fixture.database.failing = true
        fixture.database.failBeforeWork = true
        val cap = StoreWriter.MAX_PENDING_VISITS
        val perRound = cap + 2
        var expectedDrops = 0
        repeat(3) { round ->
            val visits = (0 until perRound).mapNotNull { store.recordVisit("https://r$round-v$it.example/", "", VisitTransition.LINK) }
            visits.forEach { store.amend(it, title = "Loaded") }
            expectedDrops += if (round == 0) 2 * 2 else 2 * perRound
            assertTrue(store.writer.retainedEntries <= cap)
            assertEquals(cap, store.writer.retainedEntries)
            assertEquals(expectedDrops, store.droppedVisits.value)
        }
        fixture.database.failing = false
        assertTrue(store.flush())
        assertEquals(cap, fixture.database.visitCount())
        assertTrue(fixture.history.recent(limit = cap).all { it.title == "Loaded" && it.url.startsWith("https://r0-") })
        assertTrue(store.writeFailure.value is StoreWriteException)
    }

    @Test
    fun anAmendmentOfASavedVisitStillGoesThroughWhenTheLogIsBelowTheCap(): Unit = runBlocking {
        val fixture = StoreFixture()
        val visit = fixture.store.recordVisit("https://a.example/", "", VisitTransition.LINK)!!
        assertTrue(fixture.store.flush())
        fixture.database.failing = true
        fixture.store.amend(visit, title = "Later")
        assertEquals(1, fixture.store.writer.retainedEntries)
        fixture.database.failing = false
        assertTrue(fixture.store.flush())
        assertEquals(listOf("Later"), fixture.history.recent().map { it.title })
        assertEquals(0, fixture.store.droppedVisits.value)
    }
}
