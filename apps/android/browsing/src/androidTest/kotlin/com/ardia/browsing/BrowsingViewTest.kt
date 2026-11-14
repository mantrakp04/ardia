package com.ardia.browsing

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.appmodel.AppEnvironment
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.browser.Page
import com.ardia.browser.PageState
import com.ardia.design.ArdiaTheme
import com.ardia.store.NightShadeMode
import com.ardia.store.TabOrigin
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BrowsingViewTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var model: AppModel
    private val server = BrowsingTestServer()

    @Before
    fun setUp() {
        compose.runOnUiThread {
            model = AppModel(LaunchArguments(isDemo = true), AppEnvironment.forApp(compose.activity, isDemo = true))
            model.attach(compose.activity)
        }
        compose.waitUntil(20_000) { onMain { model.isReady } }
        compose.setContent {
            ArdiaTheme(look = model.look) { BrowsingView(model, isFront = true) }
        }
    }

    @After
    fun tearDown() {
        compose.runOnUiThread {
            model.detach(compose.activity)
            model.close()
        }
        server.close()
    }

    private fun <T> onMain(work: () -> T): T {
        var result: T? = null
        compose.runOnUiThread { result = work() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun open(path: String, html: String): Page {
        server.page(path, html)
        val url = server.url(path)
        compose.runOnUiThread { model.openPage(url, TabOrigin.TYPED) }
        val title = Regex("<title>(.*?)</title>").find(html)?.groupValues?.get(1)
        compose.waitUntil(20_000) { onMain { model.currentPage?.state?.value?.let { loaded(it, url, title) } == true } }
        compose.waitForIdle()
        return onMain { model.currentPage!! }
    }

    private fun loaded(state: PageState, url: String, title: String?): Boolean =
        state.isLive && state.url == url && !state.isLoading && (title == null || state.title == title)

    @Test
    fun theBarButtonsReachTheModel() {
        open("/bar", "<title>Bar</title><p>Bar page</p>")
        compose.onNodeWithTag(BrowsingTags.MORE).performClick()
        compose.waitUntil(5_000) { onMain { model.browse.isToolbarPresented } }
        compose.runOnUiThread { model.browse.isToolbarPresented = false }
        compose.onNodeWithTag(BrowsingTags.PLUS).performClick()
        compose.waitUntil(5_000) { onMain { model.browse.search != null } }
        compose.runOnUiThread { model.browse.dismissSearch() }
        compose.onNodeWithTag(BrowsingTags.TABS).performClick()
        compose.waitUntil(5_000) { onMain { model.surface == AppModel.Surface.TabSwitcher } }
    }

    @Test
    fun thePageMenuShowsThePhoneItemsAndItsTogglesChangeModelState() {
        val page = open("/menu", "<title>Menu</title><p>Menu page</p>")
        compose.runOnUiThread { model.browse.isToolbarPresented = true }
        for (tag in listOf(
            MenuTags.BACK, MenuTags.FORWARD, MenuTags.TITLE, MenuTags.PIN, MenuTags.RELOAD, MenuTags.READER, MenuTags.COPY, MenuTags.SHARE,
            MenuTags.FIND, MenuTags.TRANSLATE, MenuTags.NIGHT_SHADE, MenuTags.ZOOM, MenuTags.DESKTOP, MenuTags.BLOCKING, MenuTags.SITE_SETTINGS,
        )) {
            compose.onNodeWithTag(tag, useUnmergedTree = true).assertExists()
        }
        compose.onNodeWithText("Find on Page").assertIsDisplayed()
        compose.onNodeWithText("Night Shade").assertIsDisplayed()
        compose.onNodeWithText("Block Ads and Trackers").assertIsDisplayed()

        compose.onNodeWithTag(MenuTags.NIGHT_SHADE).performClick()
        compose.waitUntil(5_000) { onMain { model.nightShade(page) == NightShadeMode.ALWAYS } }

        compose.onNodeWithTag(MenuTags.DESKTOP).performClick()
        compose.waitUntil(5_000) { onMain { model.isDesktopSite(page) && !model.browse.isToolbarPresented } }

        compose.runOnUiThread { model.browse.isToolbarPresented = true }
        assertTrue(onMain { model.blockersEnabled(page) })
        compose.onNodeWithTag(MenuTags.BLOCKING).performClick()
        compose.waitUntil(5_000) { onMain { !model.blockersEnabled(page) } }
    }

    @Test
    fun siteSettingsOpensFromTheMenuAndChangesBrowsingPreferences() {
        open("/site", "<title>Site</title><p>Site page</p>")
        compose.runOnUiThread { model.browse.isToolbarPresented = true }
        compose.onNodeWithTag(MenuTags.SITE_SETTINGS).performClick()
        compose.onNodeWithTag(BrowsingTags.SITE_SETTINGS).assertExists()
        val before = onMain { model.settings.collapsesBottomBar }
        compose.onNodeWithText("Collapse Bottom Bar").performClick()
        compose.waitUntil(5_000) { onMain { model.settings.collapsesBottomBar != before } }
    }

    @Test
    fun findOnPageShowsTheMatchCount() {
        open("/find", "<title>Find</title><p>otter one</p><p>otter two</p><p>otter three</p>")
        compose.runOnUiThread { model.showFindOnPage() }
        compose.onNodeWithTag(BrowsingTags.FIND_FIELD).performTextInput("otter")
        compose.waitUntil(10_000) { compose.onAllNodes(hasTestTag(BrowsingTags.FIND_COUNT) and hasText("1 of 3")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Done").performClick()
        compose.waitUntil(5_000) { onMain { !model.browse.isFindPresented } }
    }

    @Test
    fun anAlertShowsThePhoneCopyAndAnswersThePage() {
        server.page("/alerted", "<title>Waiting</title><script>setTimeout(function(){alert('Hello from the page'); document.title='Answered'}, 300)</script>")
        val url = server.url("/alerted")
        compose.runOnUiThread { model.openPage(url, TabOrigin.TYPED) }
        compose.waitUntil(20_000) { compose.onAllNodes(hasTestTag(BrowsingTags.REQUEST)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Hello from the page").assertIsDisplayed()
        compose.onNodeWithText("127.0.0.1").assertIsDisplayed()
        compose.onNodeWithText("OK").performClick()
        compose.waitUntil(10_000) { onMain { model.currentPage?.state?.value?.title == "Answered" } }
        assertEquals(0, compose.onAllNodes(hasTestTag(BrowsingTags.REQUEST)).fetchSemanticsNodes().size)
    }

    @Test
    fun systemBackClosesLayersInOrderThenGoesBackThenLeaves() {
        server.page("/second", "<title>Second</title><p>second</p>")
        val first = open("/first", "<title>First</title><a id='go' href='/second'>go</a>")
        compose.runOnUiThread { first.load(server.url("/second")) }
        compose.waitUntil(20_000) { onMain { loaded(first.state.value, server.url("/second"), "Second") } }
        assertTrue(onMain { first.state.value.canGoBack })

        compose.runOnUiThread {
            model.browse.isToolbarPresented = true
        }
        compose.waitForIdle()
        back()
        compose.waitUntil(5_000) { onMain { !model.browse.isToolbarPresented } }
        assertEquals(server.url("/second"), onMain { first.state.value.url })

        compose.runOnUiThread { model.showFindOnPage() }
        compose.waitForIdle()
        back()
        compose.waitUntil(5_000) { onMain { !model.browse.isFindPresented } }
        assertEquals(server.url("/second"), onMain { first.state.value.url })

        back()
        compose.waitUntil(20_000) { onMain { first.state.value.url == server.url("/first") } }
        assertFalse(onMain { model.surface == AppModel.Surface.TabSwitcher })

        compose.waitUntil(10_000) { onMain { !first.state.value.canGoBack } }
        back()
        compose.waitUntil(5_000) { onMain { model.surface == AppModel.Surface.TabSwitcher } }
    }

    @Test
    fun readerOpensFromTheMenuAndDoneClosesIt() {
        val paragraph = "Otters hold hands while they sleep so they do not drift apart in the water, and they keep favourite stones. "
        open("/article", "<title>Otters</title><article><h1>Otters</h1>" + List(8) { "<p>$paragraph</p>" }.joinToString("") + "</article>")
        compose.runOnUiThread { model.browse.isToolbarPresented = true }
        compose.onNodeWithTag(MenuTags.READER).performClick()
        compose.waitUntil(5_000) { onMain { model.browse.readerTabId != null } }
        compose.onNodeWithTag(BrowsingTags.READER).assertExists()
        assertNotNull(onMain { model.browse.readerTabId })
        back()
        compose.waitUntil(5_000) { onMain { model.browse.readerTabId == null } }
    }

    private fun back() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
    }
}
