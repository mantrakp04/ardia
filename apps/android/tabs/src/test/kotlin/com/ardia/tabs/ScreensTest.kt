package com.ardia.tabs

import android.content.Context
import android.os.Looper
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.performClick
import com.ardia.store.BrowserTab
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.robolectric.annotation.Config
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
import com.ardia.appmodel.TabDeckModel
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
            makeEngine = { StillPageEngine() },
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

    private fun opensTheMailTileAfterScrollingThroughTheSpace() {
        model.sheet = AppModel.Sheet.SyncedSpaces
        show { SyncedSpacesView(it) }
        waitForText("Personal")
        compose.onNodeWithContentDescription("Work").assertExists()
        val page = compose.onNode(hasTestTag(spacePageTag("demo-personal")))
        page.performScrollToNode(hasText("MacBook Pro"))
        compose.onNodeWithText("MacBook Pro").assertExists()
        page.performScrollToNode(hasText("Show All"))
        compose.onNodeWithText("Show All").assertExists()
        page.performScrollToNode(hasContentDescription("Mail"))
        val before = model.tabs.openTabs.size
        compose.onNodeWithContentDescription("Mail").performClick()
        waitFor { model.tabs.openTabs.any { it.url == "https://www.icloud.com/mail" } }
        assertEquals(before + 1, model.tabs.openTabs.size)
        assertNull(model.sheet)
        assertEquals(AppModel.Surface.Browsing, model.surface)
    }

    @Test
    fun theSpacesViewShowsTheMacsSpacesAndOpensATile() = opensTheMailTileAfterScrollingThroughTheSpace()

    @Test
    @Config(qualifiers = "w320dp-h480dp")
    fun theSpacesViewOpensATileOnASmallPhone() = opensTheMailTileAfterScrollingThroughTheSpace()

    private fun saveSnapshot(tabId: String, color: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(400, 860, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
        val name = runBlocking { model.store!!.snapshots.save(bitmap, tabId) }!!
        model.tabStore!!.update(tabId, snapshotFileName = name)
        model.snapshotVersions[tabId] = model.snapshotVersion(tabId) + 1
        return runBlocking { model.store!!.snapshots.image(name) }!!
    }

    private fun shownSnapshot(title: String): Bitmap? {
        shadowOf(Looper.getMainLooper()).idle()
        val nodes = compose.onAllNodesWithContentDescription(title).fetchSemanticsNodes()
        return nodes.firstOrNull()?.config?.getOrElseNullable(ShownSnapshot) { null }?.asAndroidBitmap()
    }

    private fun waitForCard(title: String, expected: Bitmap) {
        compose.waitUntil(TIMEOUT) { shownSnapshot(title) === expected }
    }

    private fun focusedTab(): BrowserTab {
        val order = model.deckOrder
        model.surface = AppModel.Surface.TabSwitcher
        return order[order.size - 2]
    }

    @Test
    fun aCardShowsASnapshotSavedBeforeTheDeckOpensAndItsReplacement() {
        val tab = focusedTab()
        val first = saveSnapshot(tab.id, AndroidColor.RED)
        show { TabSwitcherView(it) }
        waitForCard(tab.title, first)
        val second = saveSnapshot(tab.id, AndroidColor.BLUE)
        assertTrue(second !== first)
        waitForCard(tab.title, second)
    }

    @Test
    fun aCardShowsASnapshotThatArrivesWhileTheDeckIsOpen() {
        val tab = focusedTab()
        show { TabSwitcherView(it) }
        compose.waitUntil(TIMEOUT) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.onAllNodesWithContentDescription(tab.title).fetchSemanticsNodes().isNotEmpty()
        }
        assertNull(shownSnapshot(tab.title))
        val saved = saveSnapshot(tab.id, AndroidColor.GREEN)
        waitForCard(tab.title, saved)
    }

    @Test
    @Config(qualifiers = "w320dp-h480dp")
    fun theDeckOpenedFromAPageShowsThatPagesHandoffOnTheFrontCard() {
        val selected = model.tabs.selectedTab!!
        val handoff = Bitmap.createBitmap(400, 860, Bitmap.Config.ARGB_8888)
        model.deck.handoff = TabDeckModel.Handoff(selected.id, handoff)
        model.deck.entrance = TabDeckModel.Entrance.FromPage(selected.id)
        model.surface = AppModel.Surface.TabSwitcher
        show { TabSwitcherView(it) }
        waitForCard(selected.title, handoff)
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
