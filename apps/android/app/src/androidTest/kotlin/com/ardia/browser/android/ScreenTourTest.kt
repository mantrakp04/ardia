package com.ardia.browser.android

import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.appmodel.SettingsRoute
import com.ardia.store.TabOrigin
import org.junit.After
import org.junit.AfterClass
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

class TourState(val number: Int, val name: String, val arguments: Map<String, Any> = emptyMap(), val reach: ScreenTourTest.() -> Unit) {
    override fun toString(): String = "%02d-%s".format(number, name)
}

@RunWith(Parameterized::class)
class ScreenTourTest(private val theme: String, private val state: TourState) {
    @get:Rule
    val compose = createEmptyComposeRule()

    private var scenario: ActivityScenario<MainActivity>? = null

    val model: AppModel get() = AppTest.model

    @Before
    fun setUp() {
        AppTest.setNight(theme == DARK)
        AppTest.freshModel()
    }

    @After
    fun tearDown() {
        scenario?.close()
        AppTest.freshModel()
    }

    @Test
    fun capture() {
        val arguments = mapOf<String, Any>(LaunchArguments.ARDIA_RESTING_START to true) + state.arguments
        scenario = AppTest.launch(arguments)
        state.reach(this)
        val image = AppTest.settledScreenshot()
        AppTest.save(image, "$state-$theme.png")
    }

    fun openArticle(private: Boolean = false) {
        val url = server.url("/article")
        AppTest.onMain {
            model.isIncognito = private
            model.openPage(url, TabOrigin.TYPED)
        }
        AppTest.waitUntil("the article page in a tab") { model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url == url }
        AppTest.waitUntil("the article page loaded", 30_000) {
            val page = model.currentPage?.state?.value
            page != null && !page.isLoading && page.title == TourServer.TITLE
        }
    }

    fun present(sheet: AppModel.Sheet) {
        AppTest.onMain { model.sheet = sheet }
        AppTest.waitUntil("the ${sheet.name} sheet") { model.sheet == sheet }
    }

    fun settingsPage(route: SettingsRoute) {
        AppTest.onMain {
            model.settings.pendingRoute = route
            model.sheet = AppModel.Sheet.Settings
        }
        AppTest.waitUntil("settings opening the ${route.name} page") { model.settings.pendingRoute == null }
    }

    fun showOnboarding() {
        AppTest.waitUntil("onboarding on screen") { model.settings.isShowingOnboarding }
        AppTest.settledScreenshot(timeoutMillis = 2_000)
    }

    fun tap(text: String) {
        compose.onAllNodesWithText(text).onFirst().performClick()
        AppTest.settledScreenshot(timeoutMillis = 2_000)
    }

    fun showDeck() {
        AppTest.onMain { model.showTabSwitcher() }
        AppTest.waitUntil("the tab deck") { model.surface == AppModel.Surface.TabSwitcher }
    }

    companion object {
        const val LIGHT = "light"
        const val DARK = "dark"

        lateinit var server: TourServer
        private var initialNight: Boolean? = null

        val states: List<TourState> = buildList {
            add(TourState(1, "search-rest") { AppTest.waitUntil("the search start at rest") { model.surface == AppModel.Surface.Search && model.browse.search == null } })
            add(TourState(2, "search-tray-query", mapOf(LaunchArguments.BROWSE_QUERY to "lisbon tapas")) {
                AppTest.waitUntil("the search tray with a typed query") { model.browse.search?.initialText == "lisbon tapas" }
            })
            add(TourState(3, "page") { openArticle() })
            add(TourState(4, "page-menu") {
                openArticle()
                AppTest.onMain { model.browse.isToolbarPresented = true }
            })
            add(TourState(5, "reader") {
                openArticle()
                AppTest.onMain { model.tabs.selectedTabId?.let(model::showReader) }
                AppTest.waitUntil("the reader") { model.browse.readerTabId != null }
            })
            add(TourState(6, "find-on-page") {
                openArticle()
                AppTest.onMain {
                    model.showFindOnPage()
                    model.currentPage?.find("Lisbon")
                }
                AppTest.waitUntil("find on page with matches") { model.browse.isFindPresented && (model.currentPage?.find?.value != null) }
            })
            add(TourState(7, "tab-deck") {
                openArticle()
                showDeck()
            })
            add(TourState(8, "private-deck") {
                openArticle(private = true)
                showDeck()
            })
            add(TourState(9, "archive") { present(AppModel.Sheet.Archive) })
            add(TourState(10, "synced-spaces") { present(AppModel.Sheet.SyncedSpaces) })
            add(TourState(11, "settings") { present(AppModel.Sheet.Settings) })
            SettingsRoute.entries.forEachIndexed { index, route ->
                add(TourState(12 + index, "settings-${route.name.kebab()}") { settingsPage(route) })
            }
            val next = 12 + SettingsRoute.entries.size
            add(TourState(next, "sync-connect") { present(AppModel.Sheet.SyncSetup) })
            add(TourState(next + 1, "onboarding-welcome", mapOf(LaunchArguments.ARDIA_ONBOARDING to true)) { showOnboarding() })
            add(TourState(next + 2, "onboarding-blocking", mapOf(LaunchArguments.ARDIA_ONBOARDING to true)) {
                showOnboarding()
                tap("Get Started")
            })
            add(TourState(next + 3, "onboarding-sync", mapOf(LaunchArguments.ARDIA_ONBOARDING to true)) {
                showOnboarding()
                tap("Get Started")
                tap("Continue")
            })
            add(TourState(next + 4, "onboarding-all-set", mapOf(LaunchArguments.ARDIA_ONBOARDING to true)) {
                showOnboarding()
                tap("Get Started")
                tap("Continue")
                tap("Not Now")
            })
        }

        @JvmStatic
        @Parameterized.Parameters(name = "{1}-{0}")
        fun parameters(): List<Array<Any>> = listOf(LIGHT, DARK).flatMap { theme -> states.map { arrayOf<Any>(theme, it) } }

        @JvmStatic
        @BeforeClass
        fun startServer() {
            server = TourServer()
            initialNight = AppTest.shell("cmd uimode night").contains("yes")
        }

        @JvmStatic
        @AfterClass
        fun stopServer() {
            server.close()
            initialNight?.let(AppTest::setNight)
        }

        private fun String.kebab(): String = replace(Regex("([a-z])([A-Z])"), "$1-$2").lowercase()
    }
}
