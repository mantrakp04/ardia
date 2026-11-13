package com.ardia.browser.android

import android.content.Context
import android.os.Looper
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ApplicationProvider
import com.ardia.appmodel.AppEnvironment
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.appmodel.LaunchArguments
import com.ardia.design.ArdiaTheme
import com.ardia.store.CoreScript
import com.ardia.store.TabOrigin
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class RootLayersTest {
    @get:Rule
    val compose = createComposeRule()
    private lateinit var model: AppModel

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val real = AppEnvironment.forApp(context, isDemo = true)
        val environment = AppEnvironment(
            isDemo = true,
            preferences = real.preferences,
            blockingStore = real.blockingStore,
            openStore = real.openStore,
            makeEngine = { StillPageEngine() },
            makeSync = real.makeSync,
            makeFilterLists = real.makeFilterLists,
            coreScript = { CoreScript { _, _ -> "null" } },
            omniboxDirectory = null,
            system = real.system,
        )
        model = AppModel(LaunchArguments(isDemo = true, restingStart = true), environment)
        settle { model.isReady }
        compose.setContent {
            ArdiaTheme(darkTheme = false, look = model.look, reduceMotion = true, reduceTransparency = true) {
                RootView(model, markers)
            }
        }
        settle { true }
    }

    @After
    fun tearDown() {
        model.close()
    }

    @Test
    fun theStartScreenIsAloneAtRest() {
        assertExposed(START)
    }

    @Test
    fun theTrayHidesTheStartScreenBehindIt() {
        model.browse.presentSearch(BrowseSession.SearchOrigin.Home)
        settle { model.browse.search != null }
        assertExposed(TRAY)
    }

    @Test
    fun anOpenPageHidesTheStartScreen() {
        openPage()
        assertExposed(BROWSING)
    }

    @Test
    fun theDeckHidesThePageUnderIt() {
        openPage()
        model.showTabSwitcher()
        settle { model.surface == AppModel.Surface.TabSwitcher }
        assertExposed(DECK)
    }

    @Test
    fun theTrayOverAPageHidesThePage() {
        openPage()
        model.browse.presentSearch(BrowseSession.SearchOrigin.Page)
        settle { model.browse.search != null }
        assertExposed(TRAY)
    }

    @Test
    fun goingBackToTheStartHidesThePageAtOnce() {
        openPage()
        compose.mainClock.autoAdvance = false
        model.surface = AppModel.Surface.Search
        frames()
        assertExposed(START)
        compose.mainClock.autoAdvance = true
        settle { true }
        assertExposed(START)
    }

    @Test
    fun aSheetHidesTheScreenFromTheMomentItIsRequestedUntilItIsDismissed() {
        compose.mainClock.autoAdvance = false
        model.sheet = AppModel.Sheet.Settings
        frames()
        assertExposed(SETTINGS)
        model.sheet = null
        frames()
        assertExposed(START, SETTINGS)
        compose.mainClock.autoAdvance = true
        settle { true }
        assertExposed(START)
    }

    @Test
    fun eachSheetShowsItsOwnScreen() {
        for ((sheet, marker) in listOf(AppModel.Sheet.Archive to ARCHIVE, AppModel.Sheet.SyncedSpaces to SPACES, AppModel.Sheet.SyncSetup to SYNC_SETUP)) {
            model.sheet = sheet
            settle { true }
            assertExposed(marker)
            model.sheet = null
            settle { true }
            assertExposed(START)
        }
    }

    @Test
    fun voiceSearchHidesTheSheetAndTheScreen() {
        model.sheet = AppModel.Sheet.Settings
        model.browse.isVoicePresented = true
        settle { true }
        assertExposed(VOICE)
        model.browse.isVoicePresented = false
        settle { true }
        assertExposed(SETTINGS)
    }

    @Test
    fun onboardingHidesEverythingBelow() {
        model.sheet = AppModel.Sheet.Settings
        model.browse.isVoicePresented = true
        model.settings.showOnboarding()
        settle { true }
        assertExposed(ONBOARDING)
    }

    @Test
    fun theOnboardingSheetRequestBecomesTheCover() {
        model.sheet = AppModel.Sheet.Onboarding
        settle { model.settings.isShowingOnboarding }
        assertEquals(null, model.sheet)
        assertExposed(ONBOARDING)
    }

    private fun openPage() {
        model.openPage("https://example.com/", TabOrigin.TYPED)
        settle { model.surface == AppModel.Surface.Browsing }
    }

    private fun frames(count: Int = 3) {
        repeat(count) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.mainClock.advanceTimeByFrame()
        }
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun settle(condition: () -> Boolean) {
        val end = System.currentTimeMillis() + TIMEOUT
        while (true) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            if (condition()) break
            if (System.currentTimeMillis() > end) throw AssertionError("condition not met within $TIMEOUT ms")
            Thread.sleep(20)
        }
        shadowOf(Looper.getMainLooper()).idle()
        compose.waitForIdle()
    }

    private fun exposed(): Set<String> = ALL.filter { compose.onAllNodesWithText(it).fetchSemanticsNodes().isNotEmpty() }.toSet()

    private fun assertExposed(vararg layers: String) {
        assertEquals(layers.toSet(), exposed())
    }

    private companion object {
        const val TIMEOUT = 20_000L
        const val START = "layer: start screen"
        const val TRAY = "layer: search tray"
        const val VOICE = "layer: voice search"
        const val BROWSING = "layer: browsing"
        const val DECK = "layer: tab deck"
        const val ARCHIVE = "layer: archive"
        const val SPACES = "layer: synced spaces"
        const val SETTINGS = "layer: settings"
        const val SYNC_SETUP = "layer: sync setup"
        const val ONBOARDING = "layer: onboarding"
        val ALL = listOf(START, TRAY, VOICE, BROWSING, DECK, ARCHIVE, SPACES, SETTINGS, SYNC_SETUP, ONBOARDING)

        @Composable
        fun Marker(text: String, modifier: Modifier = Modifier.fillMaxSize()) {
            Box(modifier) { Text(text) }
        }

        val markers = RootScreens(
            searchStart = { _, modifier -> Marker(START, modifier) },
            searchTray = { model, modifier -> if (model.browse.search != null) Marker(TRAY, modifier) },
            voiceSearch = { Marker(VOICE) },
            browsing = { _, _, modifier -> Marker(BROWSING, modifier) },
            tabDeck = { _, modifier -> Marker(DECK, modifier) },
            archive = { Marker(ARCHIVE) },
            syncedSpaces = { Marker(SPACES) },
            settings = { Marker(SETTINGS) },
            syncSetup = { Marker(SYNC_SETUP) },
            onboarding = { Marker(ONBOARDING) },
        )
    }
}
