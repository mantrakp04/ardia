package com.ardia.settings

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.ardia.appmodel.AppEnvironment
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.design.ArdiaTheme
import com.ardia.design.ProfileLook
import com.ardia.sync.ConnectResult
import com.ardia.sync.LocalBrowsingSource
import com.ardia.sync.ReceivedTab
import com.ardia.sync.SyncController
import com.ardia.sync.SyncDevice
import com.ardia.sync.SyncFolderPick
import com.ardia.sync.SyncPhase
import com.ardia.sync.SyncSnapshot
import com.ardia.sync.SyncedDevice
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

class OffSyncDevice : SyncDevice {
    override val isDemo: Boolean get() = false
    override val phase: SyncPhase get() = SyncPhase.Off
    override val snapshot: SyncSnapshot = SyncSnapshot()
    override val pendingDownloads: Int get() = 0
    override val lastSynced: Long? get() = null
    override val isEnabled: Boolean get() = false
    override val isRunning: Boolean get() = false
    override val folderName: String? get() = null
    override val hasUnsentChanges: Boolean get() = false
    override val wantsBackgroundRefresh: Boolean get() = false
    override var deviceName: String = "Pixel"
    override var selectedProfileId: String? = null
    override var source: LocalBrowsingSource? = null

    override fun start() {}

    override fun becameActive() {}

    override fun resignedActive() {}

    override fun syncNow() {}

    override fun backgroundCycle(): Boolean = false

    override fun localDidChange() {}

    override fun cancelCoordination() {}

    override fun connect(phrase: String, pick: SyncFolderPick): ConnectResult = ConnectResult.FolderUnavailable

    override fun changeFolder(pick: SyncFolderPick): ConnectResult = ConnectResult.FolderUnavailable

    override fun stopSyncing() {}

    override fun acknowledgeReset() {}

    override fun send(url: String, title: String, to: SyncedDevice, profileSyncId: String?, key: String, fromPrivateTab: Boolean): Boolean = false

    override fun addBookmark(url: String, title: String, profileSyncId: String?, fromPrivateTab: Boolean): Boolean = false

    override fun takeReceived(): List<ReceivedTab> = emptyList()

    override fun close() {}
}

@RunWith(AndroidJUnit4::class)
class SettingsScreensTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val validPhrase = (List(23) { "abandon" } + "art").joinToString(" ")
    private var made: AppModel? = null

    @After
    fun closeModel() {
        val model = made ?: return
        InstrumentationRegistry.getInstrumentation().runOnMainSync { model.close() }
    }

    private fun demoModel(syncOff: Boolean = false, onboarding: Boolean = false): AppModel {
        val demo = AppEnvironment.forApp(context, isDemo = true)
        val environment = if (!syncOff) demo else AppEnvironment(
            isDemo = true,
            preferences = demo.preferences,
            blockingStore = demo.blockingStore,
            openStore = demo.openStore,
            makeEngine = demo.makeEngine,
            makeSync = { SyncController(OffSyncDevice()) },
            makeFilterLists = demo.makeFilterLists,
            coreScript = demo.coreScript,
            omniboxDirectory = demo.omniboxDirectory,
            system = demo.system,
        )
        var model: AppModel? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            model = AppModel(LaunchArguments(isDemo = true, showsOnboarding = onboarding), environment)
        }
        made = model
        compose.waitUntil(TIMEOUT) { model!!.isReady }
        return model!!
    }

    private fun show(model: AppModel, content: @Composable () -> Unit) {
        compose.setContent { ArdiaTheme(darkTheme = false, look = model.look, reduceMotion = true) { content() } }
        compose.waitForIdle()
    }

    private fun showSettings(model: AppModel) = show(model) { SettingsView(model) }

    private fun scrollTo(tag: String) {
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasTestTag(tag))
    }

    private fun open(row: String) {
        scrollTo(SettingsTags.row(row))
        compose.onNodeWithTag(SettingsTags.row(row)).performClick()
        compose.waitForIdle()
    }

    private fun toggle(name: String) {
        scrollTo(SettingsTags.toggle(name))
        compose.onNodeWithTag(SettingsTags.toggle(name)).performClick()
        compose.waitForIdle()
    }

    @Test
    fun eachSwitchChangesTheModel() {
        val model = demoModel()
        showSettings(model)

        val suggestions = model.browsing.searchSuggestions
        toggle("searchSuggestions")
        assertEquals(!suggestions, model.browsing.searchSuggestions)

        val keyboard = model.settings.autoOpensKeyboard
        toggle("autoOpenKeyboard")
        assertEquals(!keyboard, model.settings.autoOpensKeyboard)

        open("siteSettings")
        val blocking = model.blockingState
        toggle("blockAds")
        toggle("blockTrackers")
        toggle("blockCookies")
        assertEquals(!blocking.blocksAds, model.blockingState.blocksAds)
        assertEquals(!blocking.blocksTrackers, model.blockingState.blocksTrackers)
        assertEquals(!blocking.hidesCookieBanners, model.blockingState.hidesCookieBanners)

        val collapses = model.settings.collapsesBottomBar
        toggle("collapseBottomBar")
        assertEquals(!collapses, model.settings.collapsesBottomBar)
    }

    @Test
    fun pickingAColourChangesTheLook() {
        val model = demoModel()
        showSettings(model)
        scrollTo(SettingsTags.row("siteSettings"))
        compose.onNodeWithContentDescription("Green").performClick()
        compose.waitForIdle()
        assertEquals("green", model.settings.colorChoice)
        assertEquals(ProfileLook.Preset.Green, model.look.preset)
        compose.onNodeWithContentDescription("Green").assertIsSelected()

        compose.onNodeWithText("Match My Mac").performClick()
        compose.waitForIdle()
        assertNull(model.settings.colorChoice)
    }

    @Test
    fun theSearchEnginePageListsEnginesAndSelectsOne() {
        val model = demoModel(syncOff = true)
        showSettings(model)
        open("searchEngine")
        for (name in listOf("Google", "Bing", "DuckDuckGo")) compose.onNodeWithText(name).assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.row("engine.duckduckgo")).performClick()
        compose.waitForIdle()
        assertEquals("duckduckgo", model.browsing.searchEngineId)
        compose.onNodeWithTag(SettingsTags.row("engine.duckduckgo")).assertIsSelected()
    }

    @Test
    fun phraseEntryCountsWordsAndNamesAWrongWord() {
        val model = demoModel(syncOff = true)
        show(model) { SyncSetupView(model) }
        compose.onNodeWithTag(SettingsTags.row("enterWords")).performClick()
        compose.waitForIdle()

        val field = compose.onNodeWithTag(SettingsTags.row("phraseField"))
        field.performTextInput("abandon ability able")
        compose.onNodeWithTag(SettingsTags.row("wordCount")).assertTextEquals("3/24 words")
        compose.onNodeWithTag(SettingsTags.row("usePhrase")).assertIsNotEnabled()

        field.performTextClearance()
        field.performTextInput((List(23) { "abandon" } + "zzzz").joinToString(" "))
        compose.onNodeWithTag(SettingsTags.row("wordCount")).assertTextEquals("24/24 words")
        compose.onNodeWithText("“zzzz” is not a valid recovery phrase word.").assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.row("usePhrase")).assertIsNotEnabled()

        field.performTextClearance()
        field.performTextInput(validPhrase)
        compose.onNodeWithText("All 24 words check out.").assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.row("usePhrase")).assertIsEnabled().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Recovery phrase added").assertIsDisplayed()
    }

    @Test
    fun clearBrowsingDataNeedsAChoiceBeforeItEnables() {
        val model = demoModel()
        showSettings(model)
        open("clearData")
        compose.onNodeWithTag(SettingsTags.row("clearData")).assertIsEnabled()
        toggle("clearHistory")
        toggle("clearCache")
        compose.onNodeWithTag(SettingsTags.row("clearData")).assertIsNotEnabled()
        compose.onNodeWithText("Choose what to clear.").assertIsDisplayed()
        toggle("clearCookies")
        compose.onNodeWithTag(SettingsTags.row("clearData")).assertIsEnabled()
    }

    @Test
    fun theFilterListsPageShowsTheDemoListsAndTogglesOne() {
        val model = demoModel()
        compose.waitUntil(TIMEOUT) { model.filterListsState.lists.isNotEmpty() }
        showSettings(model)
        open("siteSettings")
        open("filterLists")
        val id = "ublock-filters"
        val before = model.filterListsState.list(id)!!.isEnabled
        scrollTo(SettingsTags.row("list.$id"))
        compose.onNodeWithText(model.filterListsState.list(id)!!.title).assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.toggle("list.$id")).performClick()
        compose.waitUntil(TIMEOUT) { model.filterListsState.list(id)!!.isEnabled != before }
        assertNotEquals(before, model.filterListsState.list(id)!!.isEnabled)
        scrollTo(SettingsTags.row("list.easyprivacy"))
        compose.onNodeWithText("EasyPrivacy").assertIsDisplayed()
    }

    @Test
    fun systemBackPopsTheStackThenClosesTheSheet() {
        val model = demoModel()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { model.sheet = AppModel.Sheet.Settings }
        showSettings(model)
        open("siteSettings")
        compose.onNodeWithTag(SettingsTags.toggle("blockAds")).assertIsDisplayed()
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        compose.onNodeWithTag(SettingsTags.DONE).assertIsDisplayed()
        assertEquals(AppModel.Sheet.Settings, model.sheet)
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        assertNull(model.sheet)
    }

    @Test
    fun aPendingRouteOpensItsPage() {
        val model = demoModel()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { model.settings.pendingRoute = com.ardia.appmodel.SettingsRoute.TrustedSites }
        showSettings(model)
        compose.onNodeWithText("No Trusted Sites").assertIsDisplayed()
        assertNull(model.settings.pendingRoute)
    }

    @Test
    fun onboardingWalksToItsEndAndMarksItDone() {
        val model = demoModel(onboarding = true)
        assertTrue(model.settings.isShowingOnboarding)
        show(model) { OnboardingView(model) }

        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.Welcome)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Trackers and cookie banners too.").assertIsDisplayed()
        val ads = model.blockingState.blocksAds
        compose.onNodeWithTag(SettingsTags.toggle("onboardingAds")).performClick()
        compose.waitForIdle()
        assertEquals(!ads, model.blockingState.blocksAds)
        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.Blocking)).performClick()
        compose.waitForIdle()

        compose.onNodeWithTag(OnboardingTags.step(OnboardingStep.DefaultBrowser)).assertIsDisplayed()
        val later = compose.onAllNodesWithText("Maybe Later").fetchSemanticsNodes().isNotEmpty()
        compose.onNodeWithText(if (later) "Maybe Later" else "Continue").performClick()
        compose.waitForIdle()

        compose.onNodeWithTag(OnboardingTags.step(OnboardingStep.Sync)).assertIsDisplayed()
        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.Sync)).assert(hasText("Continue"))
        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.Sync)).performClick()
        compose.waitForIdle()

        compose.onNodeWithText("You’re all set!").assertIsDisplayed()
        assertFalse(model.settings.hasFinishedOnboarding)
        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.AllSet)).performClick()
        compose.waitForIdle()
        assertTrue(model.settings.hasFinishedOnboarding)
        assertFalse(model.settings.isShowingOnboarding)
    }

    @Test
    fun onboardingSyncStepOffersToConnectWhenSyncIsOff() {
        val model = demoModel(syncOff = true, onboarding = true)
        show(model) { OnboardingView(model) }
        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.Welcome)).performClick()
        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.Blocking)).performClick()
        compose.waitForIdle()
        val later = compose.onAllNodesWithText("Maybe Later").fetchSemanticsNodes().isNotEmpty()
        compose.onNodeWithText(if (later) "Maybe Later" else "Continue").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(OnboardingTags.primary(OnboardingStep.Sync)).assert(hasText("Connect to Your Mac")).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(SettingsTags.row("scanCode")).assertIsDisplayed()
        compose.onNodeWithTag(SettingsTags.row("closeSetup")).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(OnboardingTags.SECONDARY).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("You’re all set!").assertIsDisplayed()
    }

    private companion object {
        const val TIMEOUT = 15_000L
    }
}
