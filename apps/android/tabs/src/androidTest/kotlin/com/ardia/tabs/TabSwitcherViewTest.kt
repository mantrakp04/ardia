package com.ardia.tabs

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.appmodel.AppModel
import com.ardia.store.DemoSeed
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TabSwitcherViewTest {
    @get:Rule
    val compose = createComposeRule()
    private val demo = DemoModel(compose)

    @Before
    fun setUp() {
        demo.start()
        demo.onMain { demo.model.surface = AppModel.Surface.TabSwitcher }
        demo.show { model -> if (model.surface == AppModel.Surface.TabSwitcher) TabSwitcherView(model) }
    }

    @After
    fun tearDown() = demo.close()

    @Test
    fun theDeckShowsEveryDemoTabAsACard() {
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithTag(DECK_CARD_TAG).fetchSemanticsNodes().size == DemoSeed.openPages.size }
        for (page in DemoSeed.openPages) compose.onNodeWithContentDescription(page.title).assertExists()
        compose.onNodeWithContentDescription("Sintra - Wikipedia").assertIsDisplayed()
    }

    @Test
    fun tappingACardOpensThatTabAndLeavesTheDeck() {
        val title = "The Verge"
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithTag(DECK_CARD_TAG).fetchSemanticsNodes().isNotEmpty() }
        val id = demo.onMain { demo.model.tabs.openTabs.first { it.title == title }.id }
        compose.onNodeWithContentDescription(title).performClick()
        compose.waitUntil(DemoModel.TIMEOUT) { demo.onMain { demo.model.surface } == AppModel.Surface.Browsing }
        assertEquals(id, demo.onMain { demo.model.tabs.selectedTabId })
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithTag(DECK_TAG).fetchSemanticsNodes().isEmpty() }
    }

    @Test
    fun flickingACardUpClosesItAndTheArchiveThenHoldsIt() {
        val title = "The Verge"
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithTag(DECK_CARD_TAG).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        val id = demo.onMain { demo.model.tabs.openTabs.first { it.title == title }.id }
        compose.onNodeWithContentDescription(title).performTouchInput {
            swipeUp(startY = centerY, endY = top - height / 2, durationMillis = 150)
        }
        compose.waitUntil(DemoModel.TIMEOUT) { demo.onMain { demo.model.tabs.openTabs.none { it.id == id } } }
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithTag(DECK_CARD_TAG).fetchSemanticsNodes().size == DemoSeed.openPages.size - 1 }
        demo.onMain { demo.model.loadArchive() }
        compose.waitUntil(DemoModel.TIMEOUT) { demo.onMain { demo.model.archive.any { day -> day.tabs.any { it.id == id } } } }
        assertTrue(demo.onMain { demo.model.surface } == AppModel.Surface.TabSwitcher)
    }
}
