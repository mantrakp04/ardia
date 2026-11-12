package com.ardia.tabs

import android.content.Context
import android.os.Looper
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.ardia.appmodel.AppEnvironment
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.design.ArdiaTheme
import com.ardia.store.CoreScript
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class ScreensTest {
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
            makeEngine = real.makeEngine,
            makeSync = real.makeSync,
            makeFilterLists = real.makeFilterLists,
            coreScript = { CoreScript { _, _ -> "null" } },
            omniboxDirectory = null,
            system = real.system,
        )
        model = AppModel(LaunchArguments(isDemo = true), environment)
        waitFor { model.isReady }
    }

    @After
    fun tearDown() {
        model.close()
    }

    private fun waitFor(condition: () -> Boolean) {
        val end = System.currentTimeMillis() + TIMEOUT
        while (!condition()) {
            if (System.currentTimeMillis() > end) throw AssertionError("condition not met within $TIMEOUT ms")
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(20)
        }
    }

    private fun show(content: @androidx.compose.runtime.Composable (AppModel) -> Unit) {
        compose.setContent { ArdiaTheme(darkTheme = false, look = model.look, reduceMotion = false, reduceTransparency = true) { content(model) } }
    }

    private fun waitForText(text: String) {
        compose.waitUntil(TIMEOUT) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun theArchiveListsTheDemoArchivedTabsByDay() {
        model.sheet = AppModel.Sheet.Archive
        show { ArchiveView(it) }
        waitForText("Time Out Lisbon")
        compose.onNodeWithText("Hacker News").assertExists()
    }

    @Test
    fun archiveSearchNarrowsTheListToMatchingTabs() {
        show { ArchiveView(it) }
        waitForText("Hacker News")
        compose.onNodeWithTag(ARCHIVE_SEARCH_TAG).performTextInput("Metropolitan")
        waitForText("The Metropolitan Museum of Art")
        compose.onNodeWithText("Hacker News").assertDoesNotExist()
    }

    @Test
    fun theSpacesViewShowsTheMacsSpacesPinnedItemsAndDevices() {
        model.sheet = AppModel.Sheet.SyncedSpaces
        show { SyncedSpacesView(it) }
        waitForText("Personal")
        compose.onNodeWithContentDescription("Work").assertExists()
        compose.onNodeWithContentDescription("Mail").assertExists()
        compose.onNode(hasTestTag(spacePageTag("demo-personal"))).performScrollToNode(hasText("MacBook Pro"))
        compose.onNodeWithText("MacBook Pro").assertExists()
        compose.onNode(hasTestTag(spacePageTag("demo-personal"))).performScrollToNode(hasText("Show All"))
        compose.onNodeWithText("Show All").assertExists()
    }

    @Test
    fun theDeckShowsTheDemoTabs() {
        model.surface = AppModel.Surface.TabSwitcher
        show { TabSwitcherView(it) }
        compose.waitUntil(TIMEOUT) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.onAllNodesWithText("No Open Tabs").fetchSemanticsNodes().isEmpty() &&
                compose.onAllNodes(hasTestTag(DECK_CARD_TAG)).fetchSemanticsNodes().isNotEmpty()
        }
        assertTrue(compose.onAllNodes(hasTestTag(DECK_CARD_TAG)).fetchSemanticsNodes().size >= 2)
    }

    companion object {
        const val TIMEOUT = 10_000L
    }
}
