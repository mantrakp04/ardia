package com.ardia.appmodel

import android.content.Intent
import android.os.Looper
import com.ardia.browser.DownloadOutcome
import com.ardia.blocking.BlockingSettings
import com.ardia.blocking.ContentBlocker
import com.ardia.blocking.FilterLists
import com.ardia.blocking.InMemoryBlockingStore
import com.ardia.store.BrowserStore
import com.ardia.store.TabOrigin
import java.io.File
import java.time.Duration
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
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
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class AppModelRoundTwoTest {
    private val fixtures = ArrayList<AppModelFixture>()

    private fun track(fixture: AppModelFixture) = fixture.also(fixtures::add)

    private fun fixture(separatesPrivatePages: Boolean = true) =
        track(AppModelFixture(separatesPrivatePages = separatesPrivatePages)).ready()

    @After
    fun tearDown() {
        fixtures.forEach { runCatching { it.close() } }
    }

    private fun AppModelFixture.toastText(): String? = app.toasts.current?.message?.resolve(context.resources)

    private fun AppModelFixture.flush() = runBlocking { app.store!!.flush() }

    private fun AppModelFixture.history() = runBlocking { app.store!!.history.recent() }

    private fun gatedFixture(gate: CompletableDeferred<Unit>, demo: Boolean = false) = track(
        AppModelFixture(openStore = { context ->
            gate.await()
            if (demo) BrowserStore.demo(context, callbackDispatcher = Dispatchers.Main) else BrowserStore.open(context, callbackDispatcher = Dispatchers.Main)
        }),
    )

    @Test
    fun aFreshTypedUrlAndASearchEnterHistoryAndRecentQueries() {
        val f = fixture()
        f.app.openPage("https://typed.example/", TabOrigin.TYPED)
        f.app.openSearch("lisbon trams")
        idle()
        f.flush()
        val urls = f.history().map { it.url }
        assertTrue("https://typed.example/" in urls)
        assertTrue(urls.any { it.startsWith("https://www.google.com/search?q=lisbon%20trams") })
        f.app.refreshRecents()
        idleUntil { f.app.recentQueries == listOf("lisbon trams") }
        assertTrue(f.app.sync.source!!.syncedVisits(0).any { it.url == "https://typed.example/" })
    }

    @Test
    fun reopeningAClosedTabRestoresWithoutANewVisit() {
        val f = fixture()
        f.app.openPage("https://once.example/", TabOrigin.TYPED)
        idle()
        val id = f.app.tabs.selectedTabId!!
        f.app.closeTab(id)
        idleUntil { f.app.page(id) == null }
        f.app.reopenLastClosed()
        idleUntil { f.app.page(id) != null }
        f.flush()
        assertEquals(1, f.history().count { it.url == "https://once.example/" })
    }

    @Test
    fun aLinkOpenedFromAPageRecordsALinkVisitAndABackgroundLinkOpensNoPage() {
        val f = fixture()
        f.app.openPage("https://opener.example/", TabOrigin.TYPED)
        idle()
        val opener = f.app.tabs.selectedTabId!!
        f.app.openLink("https://background.example/", opener, inBackground = true)
        idle()
        assertEquals(opener, f.app.tabs.selectedTabId)
        val background = f.app.tabs.openTabs.first { it.url == "https://background.example/" }
        assertNull(f.app.page(background.id))
        assertEquals(listOf(opener, background.id), f.app.tabs.openTabs.map { it.id })

        f.app.openLink("https://foreground.example/", opener, inBackground = false)
        idle()
        val foreground = f.app.tabs.selectedTab!!
        assertEquals("https://foreground.example/", foreground.url)
        f.flush()
        assertEquals(com.ardia.store.VisitTransition.LINK, f.history().first { it.url == "https://foreground.example/" }.transition)
        f.app.openTab(background.id)
        idle()
        f.flush()
        assertTrue(f.history().any { it.url == "https://background.example/" })
    }

    @Test
    fun aPrivateExemptionStaysInPrivateTabsAndANormalExemptionCanBeUndoneInPrivate() {
        val f = fixture()
        val blocker = ContentBlocker(BlockingSettings(InMemoryBlockingStore()), FilterLists.demo(File(f.context.cacheDir, "lists"), InMemoryBlockingStore()))
        val normal = BlockingPageFilter(isPrivate = false) { blocker }
        val private = BlockingPageFilter(isPrivate = true) { blocker }
        val ad = "https://doubleclick.net/ad.js"
        val page = "https://news.example.com/"
        assertTrue(normal.blocks(ad, page, false))
        assertTrue(private.blocks(ad, page, false))

        blocker.settings.setExempt("news.example.com", true, isPrivate = true)
        assertFalse(private.blocks(ad, page, false))
        assertTrue(normal.blocks(ad, page, false))

        blocker.settings.endPrivateBrowsing()
        blocker.settings.setExempt("news.example.com", true)
        blocker.settings.setExempt("news.example.com", false, isPrivate = true)
        assertFalse(normal.blocks(ad, page, false))
        assertTrue(private.blocks(ad, page, false))
    }

    @Test
    fun theEngineGetsANormalAndAPrivateFilterAndTheMenuMatchesThem() {
        val f = fixture()
        idleUntil { f.app.blocker != null }
        f.app.openPage("https://news.example.com/", TabOrigin.TYPED)
        idle()
        val engine = f.fakeEngine
        assertNotNull(engine.filter)
        assertNotNull(engine.privateFilter)
        f.app.isIncognito = true
        f.app.openPage("https://news.example.com/private", TabOrigin.TYPED)
        idle()
        val privatePage = f.page(f.app.tabs.selectedTabId!!)
        f.app.toggleBlockers(privatePage)
        val ad = "https://doubleclick.net/ad.js"
        assertFalse(engine.privateFilter!!.blocks(ad, "https://news.example.com/", false))
        assertTrue(engine.filter!!.blocks(ad, "https://news.example.com/", false))
        val normalPage = f.page(f.app.tabs.openTabs.first().id)
        assertTrue(f.app.blockersEnabled(normalPage))
    }

    @Test
    fun aTabLinkAtColdStartOpensOnceTheStoreLoads() {
        val first = fixture()
        first.app.openPage("https://kept.example/", TabOrigin.TYPED)
        first.app.openPage("https://other.example/", TabOrigin.TYPED)
        idle()
        val kept = first.app.tabs.openTabs.first { it.url == "https://kept.example/" }.id
        first.flush()
        first.close()
        fixtures.remove(first)

        val gate = CompletableDeferred<Unit>()
        val f = gatedFixture(gate)
        idle()
        assertTrue(f.app.openTabFromSystem(kept))
        gate.complete(Unit)
        idleUntil { f.app.isReady && f.app.surface == AppModel.Surface.Browsing }
        assertEquals(kept, f.app.tabs.selectedTabId)
    }

    @Test
    fun aTabLinkToAnArchivedTabNotInMemoryRestoresIt() {
        val first = fixture()
        first.app.openPage("https://archived.example/", TabOrigin.TYPED)
        idle()
        val id = first.app.tabs.selectedTabId!!
        first.app.archiveTab(id)
        idle()
        first.flush()
        first.close()
        fixtures.remove(first)

        val f = fixture()
        assertNull(f.app.tab(id))
        assertTrue(f.app.openTabFromSystem(id))
        idleUntil { f.app.tabs.selectedTabId == id }
        assertEquals("https://archived.example/", f.app.tabs.selectedTab?.url)
        assertEquals(AppModel.Surface.Browsing, f.app.surface)
    }

    @Test
    fun theFirstTrayPicksUpLocalCandidatesWhenTheStoreArrives() {
        val gate = CompletableDeferred<Unit>()
        val f = gatedFixture(gate, demo = true)
        idle()
        val suggestions = f.app.makeSuggestionsModel()
        val prepared = suggestions.prepare()
        idle()
        assertFalse(prepared.isCompleted)
        gate.complete(Unit)
        idleUntil { suggestions.omnibox.candidatesComplete.value }
        val sources = f.script.calls.filter { it.first == "mobileSetSources" }.map { it.second.single() }
        assertTrue(sources.any { "https://en.wikipedia.org/wiki/Sintra" in it })
        suggestions.close()
    }

    @Test
    fun closingTheModelClosesTheOmniboxScript() {
        val f = fixture()
        runBlocking { f.app.searchEngines() }
        assertTrue(f.script.calls.isNotEmpty())
        f.close()
        fixtures.remove(f)
        idleUntil { f.script.closed }
    }

    @Test
    fun withoutSeparatePrivatePagesIncognitoStaysOffAndSaysWhy() {
        val f = fixture(separatesPrivatePages = false)
        f.app.newIncognitoTab()
        assertFalse(f.app.isIncognito)
        assertNull(f.app.browse.search)
        assertFalse(f.app.supportsIncognito)
        assertEquals(AppModel.INCOGNITO_NEEDS_WEBVIEW, f.toastText())
        f.app.isIncognito = true
        assertFalse(f.app.isIncognito)
        f.app.handle(SystemLink.Incognito)
        assertFalse(f.app.isIncognito)
        f.app.searchSwitchingMode("secret")
        idle()
        assertTrue(f.app.tabs.openTabs.isEmpty())
        assertTrue(f.app.tabs.privateTabs.isEmpty())
    }

    @Test
    fun aPrivateTabTheEngineRefusesIsDroppedWithoutACrash() {
        val f = fixture(separatesPrivatePages = false)
        val tab = f.app.tabStore!!.open(com.ardia.store.TabDestination.Url("https://sneaky.example/"), isPrivate = true)
        f.app.openTab(tab.id)
        idle()
        assertNull(f.app.page(tab.id))
        assertTrue(f.app.tabs.privateTabs.isEmpty())
        assertFalse(f.app.isIncognito)
        assertEquals(AppModel.Surface.Search, f.app.surface)
        assertEquals(AppModel.INCOGNITO_NEEDS_WEBVIEW, f.toastText())
    }

    @Test
    fun theMixedDeckCountsAsPrivateWhilePrivateTabsExistAndPrivateTabsNeverReachTheArchive() {
        val f = fixture()
        f.app.openPage("https://normal.example/", TabOrigin.TYPED)
        idle()
        val normal = f.app.tabs.selectedTabId!!
        f.app.newIncognitoTab()
        f.app.submitSearch("https://private.example/", null)
        idle()
        val private = f.app.tabs.selectedTabId!!
        f.app.openTab(normal)
        idle()
        assertFalse(f.app.isIncognito)
        assertTrue(f.app.isPrivateOnScreen)
        f.app.showTabSwitcher()
        idleUntil { f.app.surface == AppModel.Surface.TabSwitcher }
        assertTrue(f.app.isPrivateOnScreen)

        f.app.closeTab(private)
        idle()
        assertFalse(f.app.isPrivateOnScreen)
        f.app.loadArchive()
        idleUntil { f.app.archiveLoaded }
        assertTrue(f.app.archive.flatMap { it.tabs }.none { it.isPrivate || it.id == private })
        assertTrue(runBlocking { f.app.searchArchive("") }.none { it.isPrivate || it.id == private })
    }

    @Test
    fun leavingIncognitoStopsPrivateDownloadsAndSaysSo() {
        val f = fixture()
        f.app.openPage("https://normal.example/", TabOrigin.TYPED)
        idle()
        val normalPage = f.page(f.app.tabs.selectedTabId!!)
        f.app.newIncognitoTab()
        f.app.submitSearch("https://private.example/", null)
        idle()
        val privatePage = f.page(f.app.tabs.selectedTabId!!)
        fun download(name: String, isPrivate: Boolean) =
            com.ardia.browser.PageDownload("https://files.example/$name", name, null, 10, null, null, null, isPrivate)
        normalPage.mutableEvents.tryEmit(com.ardia.browser.PageEvent.Download(download("open.pdf", false)))
        privatePage.mutableEvents.tryEmit(com.ardia.browser.PageEvent.Download(download("secret.pdf", true)))
        idle()
        f.system.activeDownloads.value = listOf(
            com.ardia.browser.DownloadProgress(1, "open.pdf", 1, 10),
            com.ardia.browser.DownloadProgress(2, "secret.pdf", 1, 10),
        )
        idleUntil { f.app.privateDownloadsInFlight == 1 }
        f.app.leaveIncognito()
        idleUntil { f.toastText() == AppModel.stoppedPrivateDownloads(1) }
        assertEquals(listOf(2L), f.system.cancelled)
        assertEquals(listOf(1L), f.app.downloads.map { it.id })
        f.app.toasts.dismiss()
        f.system.outcomes.tryEmit(DownloadOutcome.Failed("secret.pdf", com.ardia.browser.DownloadFailure.PrivateSessionEnded))
        idle()
        assertNull(f.app.toasts.current)
    }

    @Test
    fun aFailingSaveIsAnnouncedOnceUntilItRecovers() {
        val f = fixture()
        f.app.noteSaveFailure(java.io.IOException("disk full"))
        assertEquals(AppModel.SAVE_FAILED, f.toastText())
        f.app.toasts.dismiss()
        f.app.noteSaveFailure(java.io.IOException("still full"))
        assertNull(f.app.toasts.current)
        assertNotNull(f.app.saveFailure)
        f.app.noteSaveFailure(null)
        assertNull(f.app.saveFailure)
        f.app.noteSaveFailure(java.io.IOException("full again"))
        assertEquals(AppModel.SAVE_FAILED, f.toastText())
        assertNull(f.app.store!!.tabs.writeFailure.value)
    }

    @Test
    fun theWindowCountsAsPrivateWheneverAnyPrivateTabExistsOrIncognitoIsOn() {
        val f = fixture()
        f.app.openPage("https://public.example/", TabOrigin.TYPED)
        idle()
        val normal = f.app.tabs.selectedTabId!!
        assertFalse(f.app.isPrivateOnScreen)

        f.app.newIncognitoTab()
        assertTrue(f.app.tabs.privateTabs.isEmpty())
        assertTrue(f.app.isPrivateOnScreen)
        f.app.submitSearch("https://private.example/", null)
        idle()
        val private = f.app.tabs.selectedTabId!!

        f.app.openTab(normal)
        idle()
        assertFalse(f.app.isIncognito)
        assertEquals(AppModel.Surface.Browsing, f.app.surface)
        assertTrue(f.app.isPrivateOnScreen)

        f.app.showSearch()
        assertEquals(AppModel.Surface.Search, f.app.surface)
        assertTrue(f.app.isPrivateOnScreen)
        f.app.browse.dismissSearch()
        assertTrue(f.app.isPrivateOnScreen)

        f.app.closeTab(private)
        idle()
        assertTrue(f.app.tabs.privateTabs.isEmpty())
        assertFalse(f.app.isIncognito)
        assertFalse(f.app.isPrivateOnScreen)
    }

    @Test
    fun swipeOrderKeepsAFrozenOrderAndAppendsNewTabs() {
        val f = fixture()
        f.app.openPage("https://a.example/", TabOrigin.TYPED)
        f.app.openPage("https://b.example/", TabOrigin.TYPED)
        idle()
        val frozen = f.app.deckOrder.map { it.id }
        f.app.browse.freezeOrder(frozen)
        f.app.openTab(frozen.first())
        f.app.openPage("https://c.example/", TabOrigin.TYPED)
        idle()
        assertEquals(frozen, f.app.swipeOrder.take(2).map { it.id })
        assertEquals("https://c.example/", f.app.swipeOrder.last().url)
    }

    @Test
    fun copyAndShareGoThroughOneSystemCall() {
        val f = fixture()
        f.app.copyLink("https://copied.example/")
        idleUntil { f.system.copies.isNotEmpty() }
        assertEquals("Copied URL Without Trackers", f.toastText())
        f.app.share("https://shared.example/", "Shared")
        f.app.shareText("hello")
        f.app.shareText("https://a.example/", subject = "Open Tabs from Ardia")
        assertEquals(listOf("https://shared.example/"), f.system.shares)
        assertEquals(listOf("hello", "https://a.example/"), f.system.textShares)
        assertEquals(listOf(null, "Open Tabs from Ardia"), f.system.textSubjects)
    }

    @Test
    fun askingForTheBrowserRoleFallsBackToDefaultAppsSettings() {
        val f = fixture()
        val launched = ArrayList<Intent>()
        f.app.requestBrowserRole { launched += it }
        f.system.roleRequest = Intent("role.REQUEST")
        f.app.requestBrowserRole { launched += it }
        assertEquals(listOf("settings.DEFAULT_APPS", "role.REQUEST"), launched.map { it.action })
    }

    @Test
    fun settingsAndSearchHelpersBehaveLikeTheScreensExpect() {
        val f = fixture()
        f.app.sheet = AppModel.Sheet.Settings
        f.app.isIncognito = true
        f.app.openFromSettings("https://help.example/")
        idle()
        assertNull(f.app.sheet)
        assertFalse(f.app.tabs.selectedTab!!.isPrivate)
        assertEquals(listOf("https://help.example/"), f.app.exportableTabUrls())

        f.app.settings.finishOnboarding()
        f.app.surface = AppModel.Surface.Search
        f.app.openTrayIfWanted()
        assertEquals(BrowseSession.SearchOrigin.Home, f.app.browse.search?.origin)
        f.app.browse.dismissSearch()
        f.app.showOnboardingFromSettings()
        assertFalse(f.app.mayFocusSearch)
        f.app.openTrayIfWanted()
        assertNull(f.app.browse.search)
    }

    @Test
    fun theDemoWarmerSavesASnapshotForEachDemoTab() {
        val f = track(AppModelFixture(demo = true)).ready()
        f.flush()
        val historyBefore = f.history().size
        val job = f.app.warmDemoSnapshots()
        idleUntil(timeoutMillis = 30_000) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
            job.isCompleted
        }
        assertTrue(f.app.tabs.openTabs.all { it.snapshotFileName != null })
        assertTrue(f.fakeEngine.pages.isEmpty())
        f.flush()
        assertEquals(historyBefore, f.history().size)
    }
}
