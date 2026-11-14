package com.ardia.store

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class StoreDurabilityTest {
    private fun sent(key: String, url: String, at: Long) = IncomingTab(key, url, "There", "Mac", at, "p")

    @Test
    fun aReceivedTabIsAcknowledgedOnlyOnceItIsOnDiskAndIsNeverOpenedTwice(): Unit = runBlocking {
        val fixture = StoreFixture()
        fixture.open("https://here.example/")
        val tab = sent("send:1", "https://there.example/", fixture.clock.now)
        fixture.database.failing = true
        assertFalse(fixture.store.receive(listOf(tab)))
        assertNotNull(fixture.store.writeFailure.value)
        assertTrue(fixture.store.hasUnsavedChanges)
        assertEquals(1, fixture.database.tabCount())
        assertFalse(fixture.store.receive(listOf(tab)))
        assertEquals(1, fixture.store.openTabs.count { it.url == "https://there.example/" })

        fixture.database.failing = false
        assertTrue(fixture.store.receive(listOf(tab)))
        assertNull(fixture.store.writeFailure.value)
        assertFalse(fixture.store.hasUnsavedChanges)
        assertEquals(1, fixture.store.openTabs.count { it.url == "https://there.example/" })
        assertEquals(2, fixture.database.tabCount())
        val relaunched = fixture.relaunch()
        assertEquals(listOf("https://here.example/", "https://there.example/"), relaunched.openTabs.map { it.url })
        assertTrue(relaunched.receive(listOf(tab)))
        assertEquals(2, relaunched.openTabs.size)
    }

    @Test
    fun aFailedBatchIsKeptAndTheNextFlushWritesItWithTheNewestChangesWinning(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        fixture.database.failing = true
        val a = fixture.open("https://a.example/")
        store.update(a.id, title = "One")
        val b = fixture.open("https://b.example/")
        assertFalse(store.flush())
        assertEquals(0, fixture.database.tabCount())
        assertTrue(fixture.database.failedCommits > 0)

        store.update(a.id, title = "Two")
        store.delete(setOf(b.id))
        fixture.database.failing = false
        assertTrue(store.flush())
        assertEquals(1, fixture.database.tabCount())
        assertEquals(listOf("Two"), fixture.relaunch().openTabs.map { it.title })
    }

    @Test
    fun theNextChangeRetriesAFailedWriteWithoutAFlush() {
        val fixture = StoreFixture()
        fixture.database.failing = true
        fixture.open("https://a.example/")
        assertEquals(0, fixture.database.tabCount())
        fixture.database.failing = false
        fixture.open("https://b.example/")
        assertEquals(2, fixture.database.tabCount())
        assertFalse(fixture.store.hasUnsavedChanges)
    }

    @Test
    fun historyWritesAndClearsSurviveAFailedCommitInOrder(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        store.recordVisit("https://kept.example/", "Kept", VisitTransition.TYPED)
        fixture.database.failing = true
        store.clearHistory()
        store.recordVisit("https://after.example/", "After", VisitTransition.TYPED)
        assertFalse(store.flush())
        assertEquals(1, fixture.database.visitCount())
        fixture.database.failing = false
        assertTrue(store.flush())
        assertEquals(listOf("https://after.example/"), fixture.history.recent().map { it.url })
    }

    @Test
    fun clearingTheArchiveReportsTabsOnlyAfterTheDeleteCommits(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        val removed = ArrayList<String>()
        store.onTabsRemoved = { tabs -> removed += tabs.map { it.id } }
        val a = fixture.open("https://a.example/")
        fixture.open("https://b.example/")
        store.close(a.id)
        fixture.database.failing = true
        store.clearArchive()
        assertTrue(removed.isEmpty())
        assertEquals(2, fixture.database.tabCount())
        fixture.database.failing = false
        assertTrue(store.flush())
        assertEquals(listOf(a.id), removed)
        assertEquals(1, fixture.database.tabCount())
    }

    @Test
    fun anArchivedTabRestoresByIdAfterARelaunchWithoutOpeningTheArchive(): Unit = runBlocking {
        val fixture = StoreFixture()
        val kept = fixture.open("https://kept.example/")
        val closed = fixture.open("https://closed.example/")
        fixture.store.close(closed.id)
        val gone = fixture.open("https://gone.example/")
        fixture.store.close(gone.id)
        fixture.store.delete(setOf(gone.id))

        val relaunched = fixture.relaunch()
        assertEquals(closed.id, relaunched.findTab(closed.id)?.id)
        assertTrue(relaunched.findTab(closed.id)!!.isArchived)
        assertNull(relaunched.findTab(gone.id))
        assertFalse(relaunched.restore(kept.id))
        assertFalse(relaunched.restore("missing"))
        assertTrue(relaunched.restore(closed.id))
        assertEquals(listOf(kept.id, closed.id), relaunched.openTabs.map { it.id })
        assertEquals(closed.id, relaunched.selectedTabId)
        assertFalse(relaunched.state.value.hasArchivedTabs)
        assertEquals(listOf(kept.id, closed.id), fixture.relaunch().openTabs.map { it.id })
    }

    @Test
    fun aTabDeletedThisSessionIsNeverFoundOnDiskAgain(): Unit = runBlocking {
        val fixture = StoreFixture()
        val closed = fixture.open("https://closed.example/")
        fixture.open("https://other.example/")
        fixture.store.close(closed.id)
        fixture.database.failing = true
        fixture.store.delete(setOf(closed.id))
        assertNull(fixture.store.findTab(closed.id))
        assertFalse(fixture.store.restore(closed.id))
        fixture.database.failing = false
        assertTrue(fixture.store.flush())
        assertEquals(1, fixture.database.tabCount())
    }
}
