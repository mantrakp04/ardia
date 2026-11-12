package com.ardia.browser.android

import android.app.SearchManager
import android.content.Intent
import android.content.pm.ShortcutManager
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.runner.lifecycle.Stage
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.appmodel.SystemLink
import com.ardia.browser.android.share.ShareActivity
import com.ardia.browser.android.system.SearchTileService
import com.ardia.store.TabOrigin
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SystemEntryDeviceTest {
    private var session: AppSession? = null
    private val model: AppModel get() = AppTest.model

    @Before
    fun setUp() {
        AppTest.freshModel()
    }

    @After
    fun tearDown() {
        session?.close()
        AppTest.freshModel()
    }

    @Test
    fun launchArgumentsReachTheModel() {
        session = AppTest.launch(mapOf(LaunchArguments.ARDIA_COLOR to "green", LaunchArguments.ARDIA_RESTING_START to true))
        val (isDemo, launchColor, chosenColor, autoOpens) = AppTest.onMain {
            listOf(model.isDemo, model.launch.color, model.settings.colorChoice, model.settings.autoOpensKeyboard)
        }
        assertEquals(true, isDemo)
        assertEquals("green", launchColor)
        assertEquals("green", chosenColor)
        assertEquals(false, autoOpens)
    }

    @Test
    fun aViewLinkFromAnotherAppOpensATabInTheSameActivity() {
        session = AppTest.launch()
        val first = session!!.activity
        val url = server.url("/article?from=view")
        AppTest.start(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setClass(AppTest.context, MainActivity::class.java))
        AppTest.waitUntil("a tab for the viewed link") { model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url == url }
        assertEquals(false, AppTest.onMain { model.isIncognito })
        assertEquals(listOf(first), AppTest.activities(Stage.RESUMED).filterIsInstance<MainActivity>())
    }

    @Test
    fun finishingTheActivityDestroysItAfterALinkArrived() {
        session = AppTest.launch()
        val first = session!!.activity
        AppTest.start(Intent(Intent.ACTION_VIEW, Uri.parse(server.url("/article?from=finish"))).setClass(AppTest.context, MainActivity::class.java))
        AppTest.waitUntil("the link reaching the activity") { model.surface == AppModel.Surface.Browsing }
        AppTest.onMain { first.finish() }
        AppTest.waitUntil("the activity destroyed", AppTest.ACTIVITY_TIMEOUT_MILLIS) { first.isDestroyed }
    }

    @Test
    fun aWebSearchOpensASearchTab() {
        session = AppTest.launch()
        AppTest.start(Intent(Intent.ACTION_WEB_SEARCH).setClass(AppTest.context, MainActivity::class.java).putExtra(SearchManager.QUERY, "tapas lisbon"))
        AppTest.waitUntil("a search tab for the web search") { model.tabs.selectedTab?.url?.contains("tapas") == true }
    }

    @Test
    fun sharedTextOpensASearch() {
        session = AppTest.launch()
        AppTest.start(
            Intent(AppTest.context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "best tapas in lisbon"),
        )
        AppTest.tap("Search in Ardia")
        AppTest.waitUntil("a search tab for the shared text") {
            model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url?.contains("tapas") == true
        }
        AppTest.waitUntil("the share sheet closing", AppTest.ACTIVITY_TIMEOUT_MILLIS) { AppTest.liveActivities().none { it is ShareActivity } }
    }

    @Test
    fun aSharedLinkOpensInATab() {
        session = AppTest.launch()
        val url = server.url("/article?from=share")
        AppTest.start(
            Intent(AppTest.context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, url).putExtra(Intent.EXTRA_SUBJECT, TourServer.TITLE),
        )
        AppTest.tap("Open in Ardia")
        AppTest.waitUntil("a tab for the shared link") { model.tabs.selectedTab?.url == url }
    }

    @Test
    fun theLauncherShortcutsCarryTheIphonesQuickActions() {
        val shortcuts = AppTest.context.getSystemService(ShortcutManager::class.java).manifestShortcuts.associate { it.id to it.intent?.data?.toString() }
        assertEquals(
            mapOf(
                "search" to SystemLink.Search(null).uri,
                "voice" to SystemLink.VoiceSearch.uri,
                "incognito" to SystemLink.Incognito.uri,
                "mac-tabs" to SystemLink.MacTabs.uri,
            ),
            shortcuts,
        )
    }

    @Test
    fun theIncognitoShortcutOpensAPrivateSearch() {
        session = AppTest.launch()
        deliver(SystemLink.Incognito)
        AppTest.waitUntil("a private search") { model.isIncognito && model.browse.search != null }
        assertTrue(AppTest.onMain { model.isPrivateOnScreen })
    }

    @Test
    fun theVoiceShortcutOpensVoiceSearch() {
        session = AppTest.launch()
        deliver(SystemLink.VoiceSearch)
        AppTest.waitUntil("voice search") { model.browse.isVoicePresented }
    }

    @Test
    fun theSyncedTabsShortcutOpensTheMacsSpaces() {
        session = AppTest.launch()
        deliver(SystemLink.MacTabs)
        AppTest.waitUntil("the synced Spaces") { model.sheet == AppModel.Sheet.SyncedSpaces }
    }

    @Test
    fun theQuickSettingsTileOpensANewSearch() {
        session = AppTest.launch()
        val url = server.url("/article?from=tile")
        AppTest.onMain { model.openPage(url, TabOrigin.TYPED) }
        AppTest.waitUntil("a page before the tile") { model.surface == AppModel.Surface.Browsing }
        deliver(SearchTileService.LINK)
        AppTest.waitUntil("the search field from the tile") { model.surface == AppModel.Surface.Search && model.browse.search != null }
    }

    private fun deliver(link: SystemLink) {
        AppTest.start(SystemIntents.main(AppTest.context, link))
    }

    companion object {
        lateinit var server: TourServer

        @JvmStatic
        @BeforeClass
        fun startServer() {
            server = TourServer()
        }

        @JvmStatic
        @AfterClass
        fun stopServer() {
            server.close()
        }
    }
}
