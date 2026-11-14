package com.ardia.browser.android

import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.appmodel.SettingsRoute
import com.ardia.store.TabOrigin
import org.junit.After
import org.junit.AfterClass
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

class TourState(val number: Int, val name: String, val arguments: Map<String, Any> = emptyMap(), val reach: ScreenTourTest.() -> Unit) {
    override fun toString(): String = "%02d-%s".format(number, name)
}

@RunWith(Parameterized::class)
class ScreenTourTest(private val theme: String, private val state: TourState) {
    private var session: AppSession? = null

    val model: AppModel get() = AppTest.model

    @Before
    fun setUp() {
        AppTest.freshModel()
        AppTest.setNight(theme == DARK)
    }

    @After
    fun tearDown() {
        session?.close()
        AppTest.freshModel()
    }

    @Test
    fun capture() {
        val arguments = mapOf<String, Any>(LaunchArguments.ARDIA_RESTING_START to true) + state.arguments
        session = AppTest.launch(arguments)
        AppTest.waitUntil("the search start after launch") { model.surface == AppModel.Surface.Search }
        try {
            state.reach(this)
        } catch (missed: Throwable) {
            runCatching { AppTest.save(AppTest.settledScreenshot(timeoutMillis = 4_000), "$state-$theme-unreached.png") }
            throw AssertionError("$state ($theme): ${missed.message}", missed)
        }
        AppTest.save(AppTest.settledScreenshot(), "$state-$theme.png")
    }

    fun openArticle(private: Boolean = false) {
        val url = server.url("/article")
        AppTest.onMain {
            model.isIncognito = private
            model.openPage(url, TabOrigin.TYPED)
        }
        AppTest.waitUntil("the article page in a tab", PAGE_TIMEOUT_MILLIS) {
            model.surface == AppModel.Surface.Browsing && model.tabs.selectedTab?.url == url
        }
        AppTest.waitUntil("the article page loaded", PAGE_TIMEOUT_MILLIS) {
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
        AppTest.settledScreenshot(timeoutMillis = 4_000)
    }

    fun tap(text: String) {
        AppTest.tap(text)
        AppTest.settledScreenshot(timeoutMillis = 4_000)
    }

    fun showDeck() {
        AppTest.onMain { model.showTabSwitcher() }
        AppTest.waitUntil("the tab deck") { model.surface == AppModel.Surface.TabSwitcher }
    }

    companion object {
        const val LIGHT = "light"
        const val DARK = "dark"
        const val PAGE_TIMEOUT_MILLIS = 90_000L

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
                AppTest.waitUntil("the page menu") { model.browse.isToolbarPresented }
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
                AppTest.waitUntil("find on page with matches") { model.browse.isFindPresented && model.currentPage?.find?.value != null }
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
            val onboarding = mapOf<String, Any>(LaunchArguments.ARDIA_ONBOARDING to true)
            add(TourState(next + 1, "onboarding-welcome", onboarding) { showOnboarding() })
            add(TourState(next + 2, "onboarding-blocking", onboarding) {
                showOnboarding()
                tap("Get Started")
            })
            add(TourState(next + 3, "onboarding-default-browser", onboarding) {
                showOnboarding()
                tap("Get Started")
                tap("Continue")
            })
            add(TourState(next + 4, "onboarding-sync", onboarding) {
                showOnboarding()
                tap("Get Started")
                tap("Continue")
                tap("Maybe Later")
            })
            add(TourState(next + 5, "onboarding-all-set", onboarding) {
                showOnboarding()
                tap("Get Started")
                tap("Continue")
                tap("Maybe Later")
                tap("Continue")
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
