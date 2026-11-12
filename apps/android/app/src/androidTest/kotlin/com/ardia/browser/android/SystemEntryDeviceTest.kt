package com.ardia.browser.android

import android.content.Intent
import android.content.pm.ShortcutManager
import android.net.Uri
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.appmodel.SystemLink
import com.ardia.browser.android.share.ShareActivity
import com.ardia.browser.android.share.ShareTags
import com.ardia.browser.android.system.SearchTileService
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SystemEntryDeviceTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private var scenario: ActivityScenario<MainActivity>? = null
    private val model: AppModel get() = AppTest.model

    @Before
    fun setUp() {
        AppTest.freshModel()
    }

    @After
    fun tearDown() {
        scenario?.close()
        AppTest.freshModel()
    }

    @Test
    fun launchArgumentsReachTheModel() {
        scenario = AppTest.launch(mapOf(LaunchArguments.ARDIA_COLOR to "green", LaunchArguments.ARDIA_RESTING_START to true))
        AppTest.onMain {
            assertTrue(model.isDemo)
            assertEquals("green", model.launch.color)
            assertEquals("green", model.settings.colorChoice)
            assertEquals(false, model.settings.autoOpensKeyboard)
        }
    }

    @Test
    fun aViewLinkFromAnotherAppOpensATab() {
        scenario = AppTest.launch()
        val url = server.url("/article?from=view")
        AppTest.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setClass(AppTest.context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        AppTest.waitUntil("a tab for the viewed link") { model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url == url }
        AppTest.onMain { assertEquals(false, model.isIncognito) }
    }

    @Test
    fun aWebSearchOpensASearchTab() {
        scenario = AppTest.launch()
        AppTest.context.startActivity(
            Intent(Intent.ACTION_WEB_SEARCH).setClass(AppTest.context, MainActivity::class.java).putExtra("query", "tapas lisbon").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        AppTest.waitUntil("a search tab for the web search") { model.tabs.selectedTab?.url?.contains("tapas") == true }
    }

    @Test
    fun sharedTextOpensASearch() {
        scenario = AppTest.launch()
        val share = ActivityScenario.launch<ShareActivity>(
            Intent(AppTest.context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "best tapas in lisbon"),
        )
        compose.onNodeWithTag(ShareTags.OPEN).performClick()
        AppTest.waitUntil("a search tab for the shared text") {
            model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url?.contains("tapas") == true
        }
        share.close()
    }

    @Test
    fun aSharedLinkOpensInATab() {
        scenario = AppTest.launch()
        val url = server.url("/article?from=share")
        val share = ActivityScenario.launch<ShareActivity>(
            Intent(AppTest.context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, url).putExtra(Intent.EXTRA_SUBJECT, TourServer.TITLE),
        )
        compose.onNodeWithTag(ShareTags.OPEN).performClick()
        AppTest.waitUntil("a tab for the shared link") { model.tabs.selectedTab?.url == url }
        share.close()
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
        scenario = AppTest.launch()
        deliver(SystemLink.Incognito)
        AppTest.waitUntil("a private search") { model.isIncognito && model.browse.search != null }
    }

    @Test
    fun theVoiceShortcutOpensVoiceSearch() {
        scenario = AppTest.launch()
        deliver(SystemLink.VoiceSearch)
        AppTest.waitUntil("voice search") { model.browse.isVoicePresented }
    }

    @Test
    fun theSyncedTabsShortcutOpensTheMacsSpaces() {
        scenario = AppTest.launch()
        deliver(SystemLink.MacTabs)
        AppTest.waitUntil("the synced Spaces") { model.sheet == AppModel.Sheet.SyncedSpaces }
    }

    @Test
    fun theQuickSettingsTileOpensANewSearch() {
        scenario = AppTest.launch()
        AppTest.onMain { model.openPage(server.url("/article?from=tile"), com.ardia.store.TabOrigin.TYPED) }
        AppTest.waitUntil("a page before the tile") { model.surface == AppModel.Surface.Browsing }
        deliver(SearchTileService.LINK)
        AppTest.waitUntil("the search field from the tile") { model.surface == AppModel.Surface.Search && model.browse.search != null }
    }

    private fun deliver(link: SystemLink) {
        AppTest.context.startActivity(SystemIntents.main(AppTest.context, link))
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
