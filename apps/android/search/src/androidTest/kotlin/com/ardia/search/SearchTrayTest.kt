package com.ardia.search

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.input.key.Key
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.appmodel.AppEnvironment
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.appmodel.LaunchArguments
import com.ardia.design.ArdiaTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class SearchTrayTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var model: AppModel

    @Before
    fun setUp() {
        compose.runOnUiThread {
            model = AppModel(LaunchArguments(isDemo = true), AppEnvironment.forApp(ApplicationProvider.getApplicationContext(), isDemo = true))
            model.settings.autoOpensKeyboard = false
        }
        compose.waitUntil(TIMEOUT) { onMain { model.isReady } }
        compose.setContent {
            ArdiaTheme {
                SearchTrayHost(model)
            }
        }
        compose.runOnUiThread { model.browse.presentSearch(BrowseSession.SearchOrigin.Home) }
        compose.waitUntil(TIMEOUT) { compose.onAllNodes(hasContentDescription(FIELD)).fetchSemanticsNodes().isNotEmpty() }
    }

    @After
    fun tearDown() {
        compose.runOnUiThread { model.close() }
    }

    private fun <T> onMain(work: () -> T): T {
        var result: T? = null
        compose.runOnUiThread { result = work() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun field(): SemanticsNodeInteraction = compose.onNode(hasContentDescription(FIELD))

    private fun fieldText(): String =
        field().fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    private fun waitForRow(text: String) {
        compose.waitUntil(TIMEOUT) { compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun typingShowsSuggestionRowsFromTheDemoData() {
        field().performTextInput("lisb")
        waitForRow("Lisbon - Wikipedia")
    }

    @Test
    fun anInlineCompletionAppearsAndBackspaceRemovesIt() {
        field().performTextInput("appl")
        compose.waitUntil(TIMEOUT) { fieldText().let { it.length > 4 && it.startsWith("appl", ignoreCase = true) } }
        field().performKeyInput { pressKey(Key.Backspace) }
        compose.waitUntil(TIMEOUT) { fieldText() == "appl" }
        compose.waitForIdle()
        assertEquals("appl", fieldText())
    }

    @Test
    fun submittingAnAddressOpensATabAndLeavesSearch() {
        field().performTextInput("example.com")
        field().performImeAction()
        compose.waitUntil(TIMEOUT) {
            onMain { model.browse.search == null && model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url?.contains("example.com") == true }
        }
    }

    @Test
    fun tappingASuggestionActivatesIt() {
        field().performTextInput("pancakes")
        waitForRow("Good Old-Fashioned Pancakes Recipe")
        compose.onAllNodes(hasText("Good Old-Fashioned Pancakes Recipe", substring = true))[0].performClick()
        compose.waitUntil(TIMEOUT) {
            onMain { model.browse.search == null && model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url?.contains("pancakes") == true }
        }
    }

    @Test
    fun theIncognitoToggleChangesTheModel() {
        assertTrue(onMain { !model.isIncognito })
        compose.onNode(hasContentDescription("Activate Incognito")).performClick()
        compose.waitUntil(TIMEOUT) { onMain { model.isIncognito } }
        compose.onNode(hasContentDescription("Deactivate Incognito")).assertExists()
        compose.onNode(hasContentDescription("Deactivate Incognito")).performClick()
        compose.waitUntil(TIMEOUT) { onMain { !model.isIncognito } }
    }

    @Test
    fun clearEmptiesTheField() {
        field().performTextInput("lisb")
        compose.onNode(hasContentDescription("Clear Text")).performClick()
        compose.waitUntil(TIMEOUT) { fieldText().isEmpty() }
    }

    @Test
    fun systemBackClosesTheTray() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitUntil(TIMEOUT) { onMain { model.browse.search == null } }
        compose.waitUntil(TIMEOUT) { compose.onAllNodes(hasContentDescription(FIELD)).fetchSemanticsNodes().isEmpty() }
        assertNull(onMain { model.browse.search })
    }

    companion object {
        const val FIELD = "Search or Enter Address"
        const val TIMEOUT = 20_000L
    }
}
