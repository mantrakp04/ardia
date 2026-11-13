package com.ardia.tabs

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.appmodel.AppModel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ArchiveAndSpacesTest {
    @get:Rule
    val compose = createComposeRule()
    private val demo = DemoModel(compose)

    @Before
    fun setUp() = demo.start()

    @After
    fun tearDown() = demo.close()

    @Test
    fun theArchiveRestoresATabAndClosesItself() {
        demo.onMain { demo.model.sheet = AppModel.Sheet.Archive }
        demo.show { model -> if (model.sheet == AppModel.Sheet.Archive) ArchiveView(model) }
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithText("Time Out Lisbon").fetchSemanticsNodes().isNotEmpty() }
        val id = demo.onMain { demo.model.archive.flatMap { it.tabs }.first { it.title == "Time Out Lisbon" }.id }
        compose.onNodeWithText("Time Out Lisbon").performClick()
        compose.waitUntil(DemoModel.TIMEOUT) { demo.onMain { demo.model.tabs.openTabs.any { it.id == id } } }
        assertNull(demo.onMain { demo.model.sheet })
        assertEquals(id, demo.onMain { demo.model.tabs.selectedTabId })
    }

    @Test
    fun archiveSearchFindsAnArchivedTabByTitle() {
        demo.onMain { demo.model.sheet = AppModel.Sheet.Archive }
        demo.show { model -> ArchiveView(model) }
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithText("Hacker News").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag(ARCHIVE_SEARCH_TAG).performTextInput("Metropolitan")
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithText("The Metropolitan Museum of Art").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Hacker News").assertDoesNotExist()
    }

    @Test
    fun theSpacesViewShowsTheDemoMacsSpacesAndOpensAnItemAsATab() {
        compose.waitUntil(DemoModel.TIMEOUT) { demo.onMain { demo.model.syncSnapshot.profiles.isNotEmpty() } }
        demo.onMain { demo.model.sheet = AppModel.Sheet.SyncedSpaces }
        demo.show { model -> if (model.sheet == AppModel.Sheet.SyncedSpaces) SyncedSpacesView(model) }
        compose.waitUntil(DemoModel.TIMEOUT) { compose.onAllNodesWithText("Personal").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Work").assertExists()
        val page = compose.onNode(hasTestTag(spacePageTag("demo-personal")))
        page.performScrollToNode(hasText("MacBook Pro"))
        compose.onNodeWithText("MacBook Pro").assertExists()
        page.performScrollToNode(hasContentDescription("Mail"))
        val before = demo.onMain { demo.model.tabs.openTabs.size }
        compose.onNodeWithContentDescription("Mail").performClick()
        compose.waitUntil(DemoModel.TIMEOUT) { demo.onMain { demo.model.tabs.openTabs.any { it.url == "https://www.icloud.com/mail" } } }
        assertEquals(before + 1, demo.onMain { demo.model.tabs.openTabs.size })
        assertNull(demo.onMain { demo.model.sheet })
        assertEquals(AppModel.Surface.Browsing, demo.onMain { demo.model.surface })
    }
}
