package com.ardia.appmodel

import com.ardia.browser.DownloadOutcome
import com.ardia.browser.PageDownload
import com.ardia.browser.PageEvent
import com.ardia.browser.WebsiteDataKind
import com.ardia.store.BrowserDatabase
import com.ardia.store.BrowserStore
import com.ardia.store.ClearRange
import com.ardia.store.NightShadeMode
import com.ardia.store.SearchSuggestion
import com.ardia.store.TabOrigin
import com.ardia.sync.ReceivedTab
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AppModelTest {
    private val fixtures = ArrayList<AppModelFixture>()

    private fun fixture(launch: LaunchArguments = LaunchArguments.none, demo: Boolean = false) =
        AppModelFixture(launch, demo).also(fixtures::add).ready()

    @After
    fun tearDown() {
        fixtures.forEach { it.close() }
    }

    private fun AppModelFixture.toastText(): String? = app.toasts.current?.message?.resolve(context.resources)

    private fun AppModelFixture.flush() = runBlocking { app.store!!.flush() }

    @Test
    fun openingAndClosingTabsDrivesTheEngine() {
        val f = fixture()
        assertTrue(f.app.tabs.openTabs.isEmpty())
        f.app.openPage("https://example.com/a", TabOrigin.TYPED)
        idle()
        val id = f.app.tabs.selectedTabId!!
        assertEquals(listOf(id), f.fakeEngine.opened)
        assertEquals(AppModel.Surface.Browsing, f.app.surface)
        assertNotNull(f.app.currentPage)

        f.app.closeTab(id)
        idleUntil { id in f.fakeEngine.closed }
        assertNull(f.app.page(id))
        assertTrue(f.app.tabs.openTabs.isEmpty())
        assertNull(f.fakeEngine.pages[id])
    }

    @Test
    fun selectingAnArchivedTabsPageRestoresItsSavedState() {
        val f = fixture()
        f.app.openPage("https://example.com/a", TabOrigin.TYPED)
        idle()
        val id = f.app.tabs.selectedTabId!!
        f.page(id).savedState = byteArrayOf(7, 7)
        f.app.closeTab(id)
        idleUntil { f.app.page(id) == null }
        f.flush()
        f.app.reopenLastClosed()
        idleUntil { f.app.page(id) != null }
        assertEquals(listOf<Byte>(7, 7), f.page(id).restoredFrom?.toList())
        assertEquals(id, f.app.tabs.selectedTabId)
    }

    @Test
    fun aVisitLandsInHistoryUpdatesTheTabAndReachesTheSyncSource() {
        val f = fixture()
        f.app.openPage("https://example.com/", TabOrigin.TYPED)
        idle()
        val id = f.app.tabs.selectedTabId!!
        f.page(id).visit("https://example.com/story", "A Story")
        idleUntil { f.app.tabs.selectedTab?.title == "A Story" }
        assertEquals("https://example.com/story", f.app.tabs.selectedTab?.url)
        f.flush()
        val history = runBlocking { f.app.store!!.history.recent() }
        assertEquals(setOf("https://example.com/story", "https://example.com/"), history.map { it.url }.toSet())
        val source = f.app.sync.source
        assertTrue(source is StoreSyncSource)
        assertTrue(source!!.syncedVisits(0).any { it.url == "https://example.com/story" })
        assertTrue(source.syncedTabs().any { it.url == "https://example.com/story" })
    }

    @Test
    fun aRestoredPageRecordsNoVisitAndALateTitleAmendsTheVisit() {
        val f = fixture()
        f.app.openPage("https://example.com/", TabOrigin.TYPED)
        idle()
        val id = f.app.tabs.selectedTabId!!
        f.page(id).visit("https://example.com/old", "Old", com.ardia.browser.VisitKind.Restored)
        f.page(id).visit("https://example.com/new", "")
        idle()
        f.page(id).mutableState.value = f.page(id).mutableState.value.copy(title = "Late Title")
        idleUntil { f.app.tabs.selectedTab?.title == "Late Title" }
        f.flush()
        val history = runBlocking { f.app.store!!.history.recent() }
        assertEquals(setOf("https://example.com/new" to "Late Title", "https://example.com/" to ""), history.map { it.url to it.title }.toSet())
    }

    @Test
    fun privateTabsLeaveNothingBehind() {
        val f = fixture()
        f.app.isIncognito = true
        f.app.openPage("https://private.example/", TabOrigin.TYPED)
        idle()
        val id = f.app.tabs.selectedTabId!!
        assertTrue(f.app.tabs.selectedTab!!.isPrivate)
        val page = f.page(id)
        page.visit("https://private.example/secret", "Secret")
        idle()
        f.app.setNightShade(true, page)
        f.app.toggleBlockers(page)
        assertFalse(f.app.blockersEnabled(page))
        assertTrue(f.app.browsing.privateSites.isNotEmpty())

        f.app.leaveIncognito()
        idleUntil { id in f.fakeEngine.closed }
        f.flush()
        assertFalse(f.app.isIncognito)
        assertTrue(f.app.tabs.privateTabs.isEmpty())
        assertTrue(runBlocking { f.app.store!!.history.recent() }.isEmpty())
        assertTrue(f.app.sync.source!!.syncedTabs().isEmpty())
        assertTrue(f.app.browsing.privateSites.isEmpty())
        assertTrue(f.app.blockersEnabled(FakePage("other", com.ardia.browser.PageSetup("https://private.example/", isPrivate = true))))
        assertTrue(f.app.blocking.exemptHosts.isEmpty())
    }

    @Test
    fun pageMenuActionsChangeTheRightState() {
        val f = fixture()
        f.app.openPage("https://news.example.com/a", TabOrigin.TYPED)
        idle()
        val page = f.page(f.app.tabs.selectedTabId!!)

        f.app.setNightShade(true, page)
        assertEquals(NightShadeMode.ALWAYS, f.app.nightShade(page))
        assertEquals(1, f.fakeEngine.refreshes)
        assertEquals(com.ardia.browser.NightShadeMode.Always, f.app.sitePreferences.nightShade("news.example.com", false))

        f.app.toggleDesktopSite(page)
        assertTrue(page.desktop)
        assertTrue(f.app.isDesktopSite(page))
        f.app.toggleDesktopSite(page)
        assertFalse(page.desktop)

        f.app.toggleBlockers(page)
        assertTrue(f.app.blocking.isExempt("news.example.com"))
        assertEquals(1, page.reloads)
        assertEquals("Blockers disabled for news.example.com", f.toastText())

        f.app.translate(page)
        assertTrue(page.loads.single().startsWith("https://translate.google.com/translate?sl=auto&tl=de&u=https%3A%2F%2Fnews.example.com%2Fa"))

        assertTrue(f.app.copyCurrentLink())
        idleUntil { f.system.copies.isNotEmpty() }
        assertEquals("https://news.example.com/a", f.system.copies.single())
        assertEquals(AppModel.COPIED_URL, f.app.browse.titleFeedback)

        f.app.shareCurrentPage()
        assertEquals(listOf("https://news.example.com/a"), f.system.shares)

        f.app.openInDefaultBrowser(page)
        assertEquals(listOf("https://news.example.com/a"), f.system.externals)

        f.app.showReader(page.id)
        assertEquals(page.id, f.app.browse.readerTabId)
        f.app.showFindOnPage()
        assertTrue(f.app.browse.isFindPresented)
    }

    @Test
    fun pinToMacWithoutSyncOffersSetupAndWithSyncPins() {
        val f = fixture()
        f.app.openPage("https://example.com/", TabOrigin.TYPED)
        idleUntil { f.app.syncState.isEnabled }
        f.app.pinCurrentToMac()
        idleUntil { f.toastText() == AppModel.PINNED }
    }

    @Test
    fun searchOpensATabThroughTheSearchTemplateAndKeepsIncognito() {
        val f = fixture()
        f.app.browse.presentSearch(BrowseSession.SearchOrigin.Start)
        f.app.submitSearch("hello world", null)
        idle()
        assertTrue(f.app.tabs.selectedTab!!.url.startsWith("https://www.google.com/search?q=hello%20world"))
        assertNull(f.app.browse.search)

        f.app.isIncognito = true
        f.app.submitSearch("example.org", null)
        idle()
        assertEquals("https://example.org", f.app.tabs.selectedTab!!.url)
        assertTrue(f.app.tabs.selectedTab!!.isPrivate)

        f.app.activate(SearchSuggestion("c:1+1", SearchSuggestion.Kind.Calculation, "= 2", "1+1", null, "1+1", copyValue = "2"))
        assertEquals(listOf("2"), f.system.copies)
    }

    @Test
    fun cancellingSearchRestoresIncognitoAndReturnsToTheTab() {
        val f = fixture()
        f.app.newIncognitoTab()
        assertTrue(f.app.isIncognito)
        f.app.cancelSearch()
        assertFalse(f.app.isIncognito)
    }

    @Test
    fun actionsBeforeTheStoreLoadsRunOnceItIs() {
        val gate = CompletableDeferred<Unit>()
        val f = AppModelFixture(openStore = { context ->
            gate.await()
            BrowserStore.open(context, callbackDispatcher = kotlinx.coroutines.Dispatchers.Main)
        }).also(fixtures::add)
        idle()
        assertFalse(f.app.isReady)
        f.app.openPage("https://early.example/", TabOrigin.TYPED)
        assertEquals(AppModel.Surface.Search, f.app.surface)
        gate.complete(Unit)
        idleUntil { f.app.isReady && f.app.surface == AppModel.Surface.Browsing }
        assertEquals("https://early.example/", f.app.tabs.selectedTab?.url)
    }

    @Test
    fun sentTabsOpenOnceAndAreAnnouncedOnce() {
        val f = fixture()
        f.app.finishOnboarding()
        val source = f.app.sync.source!!
        val tab = ReceivedTab("send:1", "https://sent.example/", "Sent", "MacBook Pro", 1L, "p1", "mac")
        assertTrue(source.receive(listOf(tab)))
        idleUntil { f.toastText() == "Tab from MacBook Pro" }
        assertTrue(f.app.tabs.lastReceived.isEmpty())
        f.app.toasts.dismiss()
        assertTrue(source.receive(listOf(tab)))
        idle()
        assertEquals(1, f.app.tabs.openTabs.count { it.url == "https://sent.example/" })
        assertNull(f.app.toasts.current)
    }

    @Test
    fun receivedTabsWaitForOnboardingToFinish() {
        val f = fixture()
        f.app.settings.showOnboarding()
        f.app.sync.source!!.receive(listOf(ReceivedTab("send:2", "https://later.example/", "Later", "MacBook Pro", 1L, "p1", "mac")))
        idle()
        assertNull(f.app.toasts.current)
        f.app.finishOnboarding()
        assertEquals("Tab from MacBook Pro", f.toastText())
    }

    @Test
    fun downloadsGoToTheSystemAndTheirOutcomeIsAnnounced() {
        val f = fixture()
        f.app.openPage("https://files.example/", TabOrigin.TYPED)
        idle()
        val page = f.page(f.app.tabs.selectedTabId!!)
        val download = PageDownload("https://files.example/a.pdf", "a.pdf", "application/pdf", 10, null, null, null, false)
        page.mutableEvents.tryEmit(PageEvent.Download(download))
        idle()
        assertEquals(listOf(download), f.system.downloads)
        assertEquals("Downloading a.pdf", f.toastText())
        f.system.activeDownloads.value = listOf(com.ardia.browser.DownloadProgress(1, "a.pdf", 5, 10))
        idleUntil { f.app.downloads.singleOrNull()?.fraction == 0.5f }
        f.system.acceptsDownloads = false
        page.mutableEvents.tryEmit(PageEvent.Download(download.copy(url = "blob:https://files.example/x", fileName = "x.bin")))
        idleUntil { f.toastText() == "Couldn’t Download x.bin" }
        f.system.outcomes.tryEmit(DownloadOutcome.Failed("a.pdf", com.ardia.browser.DownloadFailure.InsecureRedirect))
        idleUntil { f.toastText() == "Couldn’t Download a.pdf" }
    }

    @Test
    fun clearingBrowsingDataClearsHistoryAndWebsiteData() {
        val f = fixture()
        f.app.openPage("https://example.com/", TabOrigin.TYPED)
        idle()
        f.page(f.app.tabs.selectedTabId!!).visit("https://example.com/x", "X")
        idle()
        f.flush()
        runBlocking { f.app.clearBrowsingData(AppModel.ClearChoice(history = true, cache = true, cookies = true, archive = false), ClearRange.ALL_TIME) }
        f.flush()
        assertTrue(runBlocking { f.app.store!!.history.recent() }.isEmpty())
        assertEquals(listOf(setOf(WebsiteDataKind.Cache, WebsiteDataKind.CookiesAndSiteData)), f.fakeEngine.cleared)
    }

    @Test
    fun theLookFollowsTheColourChoice() {
        val f = fixture()
        f.app.setColorChoice("green")
        assertEquals("green", f.app.look.preset?.key)
        f.app.setColorChoice("not-a-colour")
        assertNull(f.app.settings.colorChoice)
    }

    @Test
    fun systemLinksRouteToTheRightSurface() {
        val f = fixture()
        assertTrue(f.app.open("ardia://search"))
        assertEquals(AppModel.Surface.Search, f.app.surface)
        assertEquals(BrowseSession.SearchOrigin.Home, f.app.browse.search?.origin)
        f.app.browse.dismissSearch()
        f.app.isIncognito = true
        assertTrue(f.app.open("https://linked.example/"))
        idle()
        assertFalse(f.app.isIncognito)
        assertEquals("https://linked.example/", f.app.tabs.selectedTab?.url)
        assertFalse(f.app.open("mailto:someone@example.com"))
        f.app.handle(SystemLink.MacTabs)
        assertEquals(AppModel.Sheet.SyncedSpaces, f.app.sheet)
    }

    @Test
    fun demoModeSeedsTheDemoAndTouchesNoRealFile() {
        val f = fixture(LaunchArguments(browseSurface = "browsing", browseTab = 2), demo = true)
        idleUntil { f.app.surface == AppModel.Surface.Browsing }
        assertEquals(8, f.app.tabs.openTabs.size)
        assertEquals("https://www.apple.com/iphone/", f.app.tabs.selectedTab?.url)
        assertTrue(f.app.settings.hasFinishedOnboarding)
        idleUntil { f.app.syncSnapshot.profiles.size == 2 }
        f.app.openPage("https://demo.example/", TabOrigin.TYPED)
        idle()
        f.page(f.app.tabs.selectedTabId!!).visit("https://demo.example/page", "Demo")
        idle()
        f.flush()
        val context = f.context
        assertFalse(context.getDatabasePath(BrowserDatabase.FILE_NAME).exists())
        assertFalse(File(context.applicationInfo.dataDir, "shared_prefs/${BrowserStore.PREFERENCES_NAME}.xml").exists())
        assertFalse(File(context.applicationInfo.dataDir, "shared_prefs/${AppEnvironment.BLOCKING_PREFERENCES}.xml").exists())
        assertFalse(File(context.filesDir, BrowserStore.OMNIBOX_FOLDER).exists())
        assertFalse(File(context.noBackupFilesDir, "Sync").exists())
        assertFalse(File(context.cacheDir, BrowserStore.SNAPSHOT_FOLDER).exists())
        assertFalse(File(context.cacheDir, AppEnvironment.BLOCKING_FOLDER).exists())
    }

    @Test
    fun deckScriptStepsDriveTheDeck() {
        val f = fixture(demo = true)
        runBlocking {
            DeckDemoScript.perform(f.app, "many:3")
            DeckDemoScript.perform(f.app, "private")
            DeckDemoScript.perform(f.app, "close")
        }
        assertEquals(11, f.app.tabs.openTabs.size)
        assertEquals(1, f.app.tabs.privateTabs.size)
        assertEquals(TabDeckModel.Command.Kind.CloseFocused, f.app.deck.command?.kind)
        runBlocking { DeckDemoScript.perform(f.app, "empty") }
        assertTrue(f.app.tabs.openTabs.isEmpty())
        assertEquals(AppModel.Surface.TabSwitcher, f.app.surface)
    }

    @Test
    fun launchHooksOpenTheRequestedSheet() {
        val f = fixture(LaunchArguments(openSheet = "archive", toast = "copied"))
        idleUntil(timeoutMillis = 5_000) {
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(100))
            f.app.sheet == AppModel.Sheet.Archive && f.toastText() == "Copied URL"
        }
    }
}
