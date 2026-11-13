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
class TabStoreTest {
    private fun archived(fixture: StoreFixture, id: String) = fixture.store.openTabs.none { it.id == id } && fixture.store.tab(id)?.isArchived == true

    @Test
    fun autoArchiveAtTheEdges() {
        val cases = listOf(DAY_MS - 1 to false, DAY_MS to true, DAY_MS + 1 to true, -HOUR_MS to false)
        for ((elapsed, expected) in cases) {
            val fixture = StoreFixture()
            val idle = fixture.open("https://example.com/idle")
            val viewed = fixture.open("https://example.com/viewed")
            fixture.clock.advance(elapsed)
            fixture.store.runAutoArchive()
            assertEquals("after $elapsed ms", expected, archived(fixture, idle.id))
            assertFalse(archived(fixture, viewed.id))
            assertEquals(viewed.id, fixture.store.selectedTabId)
        }
    }

    @Test
    fun clockMovingBackwardsNeverArchivesAndTheIntervalStillCountsFromTheLastUse() {
        val fixture = StoreFixture()
        val tab = fixture.open("https://example.com/a")
        fixture.open("https://example.com/b")
        fixture.clock.advance(-7 * DAY_MS)
        assertEquals(0, fixture.store.runAutoArchive())
        fixture.clock.advance(8 * DAY_MS)
        assertEquals(1, fixture.store.runAutoArchive())
        assertTrue(archived(fixture, tab.id))
    }

    @Test
    fun archivingWaitsForTheGridGestureToEnd() {
        val fixture = StoreFixture()
        val idle = fixture.open("https://example.com/a")
        fixture.open("https://example.com/b")
        fixture.clock.advance(2 * DAY_MS)
        fixture.store.isGridInteractionActive = true
        assertEquals(0, fixture.store.runAutoArchive())
        assertFalse(archived(fixture, idle.id))
        fixture.store.isGridInteractionActive = false
        assertTrue(archived(fixture, idle.id))
    }

    @Test
    fun neverKeepsEveryTabOpenAndTheChoiceSurvivesARelaunch() {
        val fixture = StoreFixture()
        assertEquals(AutoArchiveInterval.DAY, fixture.store.autoArchiveInterval)
        fixture.store.autoArchiveInterval = AutoArchiveInterval.NEVER
        val tab = fixture.open("https://example.com/a")
        fixture.open("https://example.com/b")
        fixture.clock.advance(365 * DAY_MS)
        assertEquals(0, fixture.store.runAutoArchive())
        assertFalse(archived(fixture, tab.id))
        assertEquals("never", fixture.settings.string(TabStore.AUTO_ARCHIVE_KEY))
        assertEquals(AutoArchiveInterval.NEVER, fixture.relaunch().autoArchiveInterval)
    }

    @Test
    fun choosingAShorterIntervalArchivesAtOnce() {
        val fixture = StoreFixture()
        val idle = fixture.open("https://example.com/a")
        fixture.open("https://example.com/b")
        fixture.clock.advance(2 * HOUR_MS)
        assertEquals(0, fixture.store.runAutoArchive())
        fixture.store.autoArchiveInterval = AutoArchiveInterval.ONE_HOUR
        assertTrue(archived(fixture, idle.id))
    }

    @Test
    fun reopenUndoesCloseArchiveAndCloseAllInOrder() {
        val fixture = StoreFixture()
        val store = fixture.store
        val a = fixture.open("https://a.example/")
        val b = fixture.open("https://b.example/")
        val c = fixture.open("https://c.example/")
        store.close(b.id)
        assertEquals(c.id, store.selectedTabId)
        store.archive(c.id)
        assertEquals(a.id, store.selectedTabId)
        store.closeAll()
        assertTrue(store.openTabs.isEmpty())
        assertNull(store.selectedTabId)

        assertEquals(listOf(a.id), store.reopenLastClosed().map { it.id })
        assertEquals(listOf(c.id), store.reopenLastClosed().map { it.id })
        assertEquals(listOf(b.id), store.reopenLastClosed().map { it.id })
        assertEquals(listOf(a.id, b.id, c.id), store.openTabs.map { it.id })
        assertEquals(b.id, store.selectedTabId)
        assertFalse(store.state.value.canReopenClosed)
        assertTrue(store.reopenLastClosed().isEmpty())
    }

    @Test
    fun undoKeepsOnlyTheLastTwentyAndSkipsDeletedTabs() {
        val fixture = StoreFixture()
        val tabs = (0 until 22).map { fixture.open("https://example.com/$it") }
        for (tab in tabs) fixture.store.close(tab.id)
        fixture.store.delete(setOf(tabs[21].id))
        val reopened = ArrayList<String>()
        while (fixture.store.state.value.canReopenClosed) reopened += fixture.store.reopenLastClosed().map { it.id }
        assertEquals(tabs.subList(2, 21).reversed().map { it.id }, reopened)
    }

    @Test
    fun archiveGroupsByDayNewestFirstAndRestoreSelects(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        store.loadArchive()
        val first = fixture.open("https://one.example/")
        store.close(first.id)
        fixture.clock.advance(2 * DAY_MS)
        val second = fixture.open("https://two.example/")
        store.close(second.id)
        assertEquals(listOf(listOf(second.id), listOf(first.id)), store.archive.value.map { day -> day.tabs.map { it.id } })
        assertTrue(store.restore(first.id))
        assertEquals(listOf(listOf(second.id)), store.archive.value.map { day -> day.tabs.map { it.id } })
        assertEquals(first.id, store.selectedTabId)
    }

    @Test
    fun movingKeepsOrderAcrossARelaunch() {
        val fixture = StoreFixture()
        val tabs = (0 until 4).map { fixture.open("https://example.com/$it") }
        repeat(60) {
            fixture.store.move(tabs[3].id, 1)
            fixture.store.move(tabs[1].id, 1)
        }
        val order = fixture.store.openTabs.map { it.id }
        assertEquals(order, fixture.relaunch().openTabs.map { it.id })
    }

    @Test
    fun syncSeesRecentWebTabsAndGroupedVisits(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        val start = fixture.clock.now
        fixture.open("https://old.example/")
        fixture.clock.advance(10_000)
        fixture.open("ardia://inbox")
        store.recordVisit("https://a.example/", "", VisitTransition.TYPED)
        fixture.clock.advance(10_000)
        val visit = store.recordVisit("https://a.example/", "A", VisitTransition.LINK)!!
        store.amend(visit, title = "A page")
        assertNull(store.recordVisit("ardia://browse/x", "", VisitTransition.LINK))
        fixture.clock.advance(10_000)
        store.recordVisit("https://b.example/", "B", VisitTransition.LINK)

        assertEquals(listOf("https://old.example/"), store.syncedTabs().map { it.url })
        val visits = fixture.history.syncedVisits(start)
        assertEquals(listOf("https://a.example/", "https://b.example/"), visits.map { it.url })
        assertEquals(2, visits.first().visitedAt.size)
        assertEquals("A page", visits.first().title)

        fixture.history.removeVisits(setOf("https://a.example/"), null)
        assertEquals(listOf("https://b.example/"), fixture.history.syncedVisits(start).map { it.url })
    }

    @Test
    fun receivedTabsOpenOnceInTheBackgroundEvenAfterARelaunch() {
        val fixture = StoreFixture()
        val current = fixture.open("https://here.example/")
        val sent = IncomingTab("send:1", "https://there.example/", "There", "Mac", fixture.clock.now, "p")
        val unsafe = IncomingTab("send:2", "javascript:alert(1)", "", "Mac", fixture.clock.now, "p")
        assertTrue(fixture.store.receive(listOf(sent, unsafe)))
        fixture.store.receive(listOf(sent))
        assertEquals(listOf("https://here.example/", "https://there.example/"), fixture.store.openTabs.map { it.url })
        assertEquals(current.id, fixture.store.selectedTabId)
        assertEquals(listOf(TabOrigin.SENT), fixture.store.state.value.lastReceived.map { it.origin })
        assertEquals(listOf("Mac"), fixture.store.state.value.lastReceived.map { it.receivedFromDevice })
        val there = fixture.store.openTabs.last()
        fixture.store.close(there.id)
        fixture.relaunch().receive(listOf(sent))
        assertEquals(listOf("https://here.example/"), fixture.store.openTabs.map { it.url })
    }

    @Test
    fun searchesUseTheEngineTemplateWithUriComponentEncoding() {
        val fixture = StoreFixture()
        fixture.store.searchTemplate = "https://duckduckgo.com/?q=%s"
        val tab = fixture.store.open(TabDestination.Search("  c++ & rust's \"best\" ? "))
        assertEquals("https://duckduckgo.com/?q=c%2B%2B%20%26%20rust's%20%22best%22%20%3F", tab.url)
        assertEquals(TabOrigin.SEARCH, tab.origin)
    }

    @Test
    fun privateTabsNeverReachTheDiskHistorySyncOrUndo(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        val start = fixture.clock.now
        val normal = fixture.open("https://normal.example/")
        val secret = store.open(TabDestination.Url("https://secret.example/"), isPrivate = true)
        val child = store.open(TabDestination.Url("https://secret.example/next", TabOrigin.LINK), TabPlacement.After(secret.id))
        assertTrue(child.isPrivate)
        assertNull(store.recordVisit("https://secret.example/", "Secret", VisitTransition.TYPED, fromTab = secret.id))
        store.update(secret.id, title = "Secret")
        store.saveInteractionState(secret.id, byteArrayOf(1, 2, 3))
        assertEquals(listOf<Byte>(1, 2, 3), store.interactionState(secret.id)?.toList())
        assertEquals(listOf("https://normal.example/"), store.syncedTabs().map { it.url })
        assertTrue(fixture.history.syncedVisits(start).isEmpty())
        assertTrue(store.flush())
        assertEquals(1, fixture.database.tabCount())
        assertEquals(0, fixture.database.visitCount())
        assertNull(fixture.database.state(secret.id))

        val closed = ArrayList<Pair<Int, Boolean>>()
        store.onPrivateTabsClosed = { ids, noneLeft -> closed.add(ids.size to noneLeft) }
        store.close(child.id)
        assertEquals(secret.id, store.selectedTabId)
        store.closeAllPrivate()
        assertEquals(listOf(1 to false, 1 to true), closed)
        assertEquals(normal.id, store.selectedTabId)
        assertFalse(store.state.value.canReopenClosed)
        assertNull(store.interactionState(secret.id))
        val relaunched = fixture.relaunch()
        assertEquals(listOf(normal.id), relaunched.openTabs.map { it.id })
        assertTrue(relaunched.privateTabs.isEmpty())
    }

    @Test
    fun removingVisitsTouchesOnlyTheGivenProfile(): Unit = runBlocking {
        val fixture = StoreFixture()
        val start = fixture.clock.now
        val url = "https://shared.example/"
        for (profile in listOf("work", "home", null)) {
            fixture.store.profileSyncId = profile
            fixture.store.recordVisit(url, "", VisitTransition.LINK)
        }
        suspend fun profiles() = fixture.history.syncedVisits(start).map { it.profileSyncId ?: "none" }.toSet()
        fixture.history.removeVisits(setOf(url), "work")
        assertEquals(setOf("home", "none"), profiles())
        fixture.history.removeVisits(setOf(url), null)
        assertEquals(setOf("home"), profiles())
    }

    @Test
    fun aVisitGoesToTheSpaceOfTheTabThatMadeIt(): Unit = runBlocking {
        val fixture = StoreFixture()
        val start = fixture.clock.now
        fixture.store.profileSyncId = "personal"
        val personal = fixture.open("https://personal.example/")
        fixture.store.profileSyncId = "work"
        fixture.store.recordVisit("https://personal.example/next", "", VisitTransition.LINK, fromTab = personal.id)
        fixture.store.recordVisit("https://typed.example/", "", VisitTransition.TYPED)
        val byUrl = fixture.history.syncedVisits(start).associate { it.url to it.profileSyncId }
        assertEquals("personal", byUrl["https://personal.example/next"])
        assertEquals("work", byUrl["https://typed.example/"])
    }

    @Test
    fun everySpaceKeepsItsOwnRecentTabsForSync() {
        val fixture = StoreFixture()
        fixture.store.profileSyncId = "personal"
        fixture.open("https://personal.example/")
        fixture.store.profileSyncId = "work"
        for (index in 0..TabStore.SYNCED_TAB_LIMIT) {
            fixture.clock.advance(60_000)
            fixture.open("https://work.example/$index")
        }
        val synced = fixture.store.syncedTabs()
        assertEquals(TabStore.SYNCED_TAB_LIMIT, synced.count { it.profileSyncId == "work" })
        assertEquals(listOf("https://personal.example/"), synced.filter { it.profileSyncId == "personal" }.map { it.url })
    }

    @Test
    fun aLinkOpensInTheSpaceOfTheTabThatOpenedIt() {
        val fixture = StoreFixture()
        val store = fixture.store
        store.profileSyncId = "work"
        val work = fixture.open("https://work.example/")
        store.profileSyncId = "personal"
        val child = store.open(TabDestination.Url("https://work.example/child", TabOrigin.LINK), TabPlacement.After(work.id))
        val typed = store.open(TabDestination.Url("https://typed.example/"))
        assertEquals("work", child.profileSyncId)
        assertEquals("personal", typed.profileSyncId)
        assertEquals(listOf(work.id, child.id, typed.id), store.openTabs.map { it.id })
        store.profileSyncId = null
        val unassigned = fixture.open("https://before-sync.example/")
        store.profileSyncId = "work"
        val unassignedChild = store.open(TabDestination.Url("https://before-sync.example/child", TabOrigin.LINK), TabPlacement.After(unassigned.id))
        assertNull(unassignedChild.profileSyncId)
    }

    @Test
    fun aVisitThatArrivesAfterItsPrivateTabClosedIsNotRecorded(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        val start = fixture.clock.now
        val normal = fixture.open("https://normal.example/")
        val secret = store.open(TabDestination.Url("https://secret.example/"), isPrivate = true)
        store.close(secret.id)
        assertNull(store.recordVisit("https://secret.example/late", "Late", VisitTransition.LINK, fromTab = secret.id))
        assertNull(store.recordVisit("https://nowhere.example/", "Nowhere", VisitTransition.LINK, fromTab = "never-opened"))
        assertTrue(fixture.history.syncedVisits(start).isEmpty())
        assertNotNull(store.recordVisit("https://normal.example/next", "Next", VisitTransition.LINK, fromTab = normal.id))
        assertEquals(listOf("https://normal.example/next"), fixture.history.syncedVisits(start).map { it.url })
    }

    @Test
    fun visitsForChosenUrlsMatchTheFullScanAndSkipPrivateTabs(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        val secret = store.open(TabDestination.Url("https://secret.example/"), isPrivate = true)
        store.recordVisit("https://secret.example/", "Secret", VisitTransition.TYPED, fromTab = secret.id)
        listOf("https://a.example/", "https://b.example/", "https://a.example/", "https://c.example/").forEachIndexed { index, url ->
            store.profileSyncId = if (index == 3) "work" else null
            fixture.clock.advance(60_000)
            store.recordVisit(url, "T$index", VisitTransition.LINK)
        }
        val wanted = setOf("https://a.example/", "https://c.example/", "https://secret.example/", "https://missing.example/")
        val direct = fixture.history.syncedVisits(wanted)
        val scanned = fixture.history.syncedVisits(0L).filter { it.url in wanted }
        assertEquals(scanned, direct)
        assertEquals(listOf("https://a.example/", "https://c.example/"), direct.map { it.url })
        assertEquals(2, direct.first().visitedAt.size)
        assertEquals("work", direct.last().profileSyncId)
        assertTrue(fixture.history.syncedVisits(emptySet()).isEmpty())
    }

    @Test
    fun listingRevisionMovesOnlyWhenWhatTheListShowsChanges() {
        val fixture = StoreFixture()
        val store = fixture.store
        var last = store.state.value.listingRevision
        fun moved(): Boolean {
            val now = store.state.value.listingRevision
            return (now != last).also { last = now }
        }
        val first = fixture.open("https://example.com/a")
        assertTrue(moved())
        val second = fixture.open("https://example.com/b")
        assertTrue(moved())
        store.select(first.id)
        assertFalse(moved())
        store.update(first.id, faviconUrl = "https://example.com/icon.png", themeColorHex = "#FFFFFF")
        assertFalse(moved())
        store.update(first.id, title = "A")
        assertTrue(moved())
        store.update(first.id, title = "A")
        assertFalse(moved())
        store.recordVisit("https://example.com/a", "A", VisitTransition.LINK)
        assertFalse(moved())
        store.close(second.id)
        assertTrue(moved())
        store.reopenLastClosed()
        assertTrue(moved())
        store.close(first.id)
        assertTrue(moved())
        store.clearArchive()
        assertTrue(moved())
        store.clearArchive()
        assertFalse(moved())
        val incognito = store.open(TabDestination.Url("https://example.com/private"), isPrivate = true)
        assertFalse(moved())
        store.update(incognito.id, title = "Private")
        assertFalse(moved())
    }

    @Test
    fun everythingButPrivateTabsSurvivesTheProcessDying(): Unit = runBlocking {
        val name = "relaunch-${System.nanoTime()}.db"
        val fixture = StoreFixture(name)
        val store = fixture.store
        val kept = fixture.open("https://kept.example/")
        store.update(kept.id, title = "Kept", faviconUrl = "https://kept.example/icon.png", snapshotFileName = "${kept.id}.jpg")
        store.saveInteractionState(kept.id, byteArrayOf(7, 8))
        fixture.clock.advance(1_000)
        val closed = fixture.open("https://closed.example/")
        store.close(closed.id)
        store.select(kept.id)
        store.open(TabDestination.Url("https://private.example/"), isPrivate = true)
        store.recordVisit("https://kept.example/", "Kept", VisitTransition.TYPED)

        val relaunched = fixture.relaunch()
        assertEquals(listOf(kept.id), relaunched.openTabs.map { it.id })
        assertEquals(kept.id, relaunched.selectedTabId)
        assertEquals("Kept", relaunched.openTabs.single().title)
        assertEquals("${kept.id}.jpg", relaunched.openTabs.single().snapshotFileName)
        assertEquals(listOf<Byte>(7, 8), relaunched.interactionState(kept.id)?.toList())
        assertTrue(relaunched.state.value.hasArchivedTabs)
        assertEquals(listOf(closed.id), relaunched.searchArchive("closed").map { it.id })
        assertTrue(relaunched.restore(closed.id))
        assertEquals(listOf(kept.id, closed.id), relaunched.openTabs.map { it.id })
        assertEquals(listOf("https://kept.example/"), relaunched.history.recent().map { it.url })
        fixture.database.close()
        fixture.context.deleteDatabase(name)
    }

    @Test
    fun launchPrunesHistoryAndArchiveOlderThanNinetyDays(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        store.recordVisit("https://old.example/", "", VisitTransition.TYPED)
        val old = fixture.open("https://old-tab.example/")
        fixture.open("https://keep.example/")
        store.close(old.id)
        fixture.clock.advance(91 * DAY_MS)
        store.recordVisit("https://new.example/", "", VisitTransition.TYPED)
        val relaunched = fixture.relaunch()
        assertEquals(listOf("https://new.example/"), relaunched.history.recent().map { it.url })
        assertTrue(relaunched.searchArchive("").isEmpty())
        assertFalse(relaunched.state.value.hasArchivedTabs)
        assertEquals(1, fixture.database.tabCount())
    }

    @Test
    fun clearingTheArchiveDeletesFromDiskAndReportsTheTabs(): Unit = runBlocking {
        val fixture = StoreFixture()
        val store = fixture.store
        val removed = ArrayList<String>()
        store.onTabsRemoved = { tabs -> removed += tabs.map { it.id } }
        val a = fixture.open("https://a.example/")
        val b = fixture.open("https://b.example/")
        store.close(a.id)
        assertTrue(store.state.value.hasArchivedTabs)
        store.clearArchive()
        assertEquals(listOf(a.id), removed)
        assertFalse(store.state.value.hasArchivedTabs)
        assertFalse(store.state.value.canReopenClosed)
        assertEquals(listOf(b.id), fixture.relaunch().openTabs.map { it.id })
        assertEquals(1, fixture.database.tabCount())
    }

    @Test
    fun closingTheSelectedTabSelectsItsNeighbourAndAnOpenTabStaysSelectedAcrossARelaunch() {
        val fixture = StoreFixture()
        val a = fixture.open("https://a.example/")
        val b = fixture.open("https://b.example/")
        val c = fixture.open("https://c.example/")
        fixture.store.select(b.id)
        fixture.clock.advance(1_000)
        fixture.store.close(b.id)
        assertEquals(c.id, fixture.store.selectedTabId)
        assertEquals(listOf(a.id, c.id), fixture.store.openTabs.map { it.id })
        assertEquals(c.id, fixture.relaunch().selectedTabId)
    }

    @Test
    fun deckOrderPutsTheSelectedTabLastAndOlderTabsFirst() {
        val fixture = StoreFixture()
        val a = fixture.open("https://a.example/")
        fixture.clock.advance(1_000)
        val b = fixture.open("https://b.example/")
        fixture.clock.advance(1_000)
        val secret = fixture.store.open(TabDestination.Url("https://secret.example/"), isPrivate = true)
        fixture.clock.advance(1_000)
        fixture.store.select(a.id)
        assertEquals(listOf(b.id, secret.id, a.id), fixture.store.state.value.deckOrder.map { it.id })
    }
}
