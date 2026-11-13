package com.ardia.browsing

import android.content.Context
import android.graphics.Bitmap
import android.os.Looper
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.view.WindowCompat
import androidx.test.core.app.ApplicationProvider
import com.ardia.appmodel.AppEnvironment
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.appmodel.LaunchArguments
import com.ardia.browser.FindResult
import com.ardia.browser.FullscreenVideo
import com.ardia.browser.Page
import com.ardia.browser.PageEngine
import com.ardia.browser.PageEvent
import com.ardia.browser.PageFilter
import com.ardia.browser.PageRequest
import com.ardia.browser.PageSetup
import com.ardia.browser.PageState
import com.ardia.browser.PageTone
import com.ardia.browser.PopupRequest
import com.ardia.browser.PressTarget
import com.ardia.browser.ReadableContent
import com.ardia.browser.ReadableContentException
import com.ardia.browser.WebsiteDataKind
import com.ardia.design.ArdiaTheme
import com.ardia.store.CoreScript
import com.ardia.store.TabOrigin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

private class HistoryPage(override val id: String, setup: PageSetup) : Page {
    override val isPrivate: Boolean = setup.isPrivate
    val mutableState = MutableStateFlow(PageState(url = setup.url, title = setup.title, isLive = true))
    var backs = 0
    override val state: StateFlow<PageState> = mutableState
    override val view: StateFlow<View?> = MutableStateFlow(null)
    override val request: StateFlow<PageRequest?> = MutableStateFlow(null)
    override val find: StateFlow<FindResult?> = MutableStateFlow(null)
    override val fullscreen: StateFlow<FullscreenVideo?> = MutableStateFlow(null)
    override val events: SharedFlow<PageEvent> = MutableSharedFlow()

    override fun load(url: String) = Unit
    override fun reload() = Unit
    override fun stop() = Unit

    override fun goBack(): Boolean {
        if (!mutableState.value.canGoBack) return false
        backs += 1
        mutableState.value = mutableState.value.copy(url = "https://first.example/", canGoBack = false)
        return true
    }

    override fun goForward(): Boolean = false
    override fun find(text: String) = Unit
    override fun findNext() = Unit
    override fun findPrevious() = Unit
    override fun endFind() = Unit
    override fun setPageZoom(zoom: Double) = Unit
    override fun zoomIn() = Unit
    override fun zoomOut() = Unit
    override fun setDesktopSite(enabled: Boolean) = Unit
    override fun download(url: String) = Unit
    override suspend fun readableContent(): ReadableContent = throw ReadableContentException(ReadableContentException.Reason.NotReadable)
    override suspend fun snapshot(maxWidth: Int): Bitmap? = Bitmap.createBitmap(4, 8, Bitmap.Config.ARGB_8888)
    override suspend fun sampleTone(topInset: Int, bottomInset: Int): PageTone? = null
    override fun saveState(): ByteArray? = null
    override fun close() = Unit
}

private class HistoryEngine : PageEngine {
    val pages = LinkedHashMap<String, HistoryPage>()
    override val name = "History"
    override val isDevelopmentOnly = true
    override val separatesPrivatePages = true
    override val livePageIds: List<String> get() = pages.keys.toList()
    override var filter: PageFilter? = null
    override var privateFilter: PageFilter? = null
    override var isInspectable = false
    override var onPrivateBrowsingEnded: (() -> Unit)? = null
    override fun open(id: String, setup: PageSetup): Page = pages.getOrPut(id) { HistoryPage(id, setup) }
    override fun openPopup(id: String, popup: PopupRequest): Page = open(id, PageSetup(popup.url, isPrivate = popup.isPrivate))
    override fun existing(id: String): Page? = pages[id]
    override fun close(id: String) {
        pages.remove(id)
    }
    override fun discardBackgroundPages() = Unit
    override fun refreshSitePreferences() = Unit
    override fun attach(activity: Context) = Unit
    override fun detach(activity: Context) = Unit
    override fun warmUp() = Unit
    override suspend fun clearWebsiteData(kinds: Set<WebsiteDataKind>) = Unit
}

@RunWith(RobolectricTestRunner::class)
class BackOrderScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var model: AppModel
    private val engine = HistoryEngine()

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val real = AppEnvironment.forApp(context, isDemo = true)
        val environment = AppEnvironment(
            isDemo = true,
            preferences = real.preferences,
            blockingStore = real.blockingStore,
            openStore = real.openStore,
            makeEngine = { engine },
            makeSync = real.makeSync,
            makeFilterLists = real.makeFilterLists,
            coreScript = { CoreScript { _, _ -> "null" } },
            omniboxDirectory = null,
            system = real.system,
        )
        model = AppModel(LaunchArguments(isDemo = true), environment)
        waitFor { model.isReady }
        model.openPage("https://second.example/", TabOrigin.TYPED)
        waitFor { model.currentPage != null }
        page().mutableState.value = page().mutableState.value.copy(url = "https://second.example/", canGoBack = true)
        context.getSharedPreferences("ardia.reader", Context.MODE_PRIVATE).edit().putString("reader.theme", "dark").commit()
        compose.setContent {
            ArdiaTheme(darkTheme = false, look = model.look, reduceMotion = true, reduceTransparency = true) { BrowsingView(model, isFront = true) }
        }
        settle()
    }

    @After
    fun tearDown() {
        model.close()
    }

    private fun page(): HistoryPage = model.currentPage as HistoryPage

    private fun settle() {
        shadowOf(Looper.getMainLooper()).idle()
        compose.waitForIdle()
    }

    private fun waitFor(condition: () -> Boolean) {
        val end = System.currentTimeMillis() + TIMEOUT
        while (!condition()) {
            if (System.currentTimeMillis() > end) throw AssertionError("condition not met within $TIMEOUT ms")
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(20)
        }
    }

    private fun back() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        settle()
    }

    @Test
    fun backClosesEachLayerBeforeTheHistoryAndLeavesAtItsStart() {
        model.browse.isToolbarPresented = true
        settle()
        compose.onNodeWithTag(MenuTags.SITE_SETTINGS).performScrollTo().performClick()
        settle()
        compose.onNodeWithTag(BrowsingTags.SITE_SETTINGS).assertExists()
        back()
        assertTrue(model.browse.isToolbarPresented)
        compose.onNodeWithTag(BrowsingTags.SITE_SETTINGS).assertDoesNotExist()
        back()
        assertFalse(model.browse.isToolbarPresented)

        model.browse.readerTabId = model.tabs.selectedTabId
        settle()
        back()
        assertNull(model.browse.readerTabId)

        model.browse.press = BrowseSession.PagePress(model.tabs.selectedTabId!!, PressTarget.Link("https://link.example/", "Link"), 10f, 10f)
        settle()
        back()
        assertNull(model.browse.press)

        model.showFindOnPage()
        settle()
        back()
        assertFalse(model.browse.isFindPresented)
        assertEquals(0, page().backs)

        back()
        assertEquals(1, page().backs)
        assertEquals("https://first.example/", page().state.value.url)
        assertEquals(AppModel.Surface.Browsing, model.surface)

        back()
        waitFor { model.surface == AppModel.Surface.TabSwitcher }
    }

    @Test
    fun backRightAfterALayerClosesInTheModelGoesBackInsteadOfBeingSwallowed() {
        model.showFindOnPage()
        settle()
        compose.runOnUiThread {
            model.endFindOnPage()
            compose.activity.onBackPressedDispatcher.onBackPressed()
        }
        settle()
        assertEquals(1, page().backs)
    }

    @Test
    fun theReaderSetsStatusIconsForItsThemeAndHandsThemBackWhenItCloses() {
        val controller = WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView)
        assertTrue(controller.isAppearanceLightStatusBars)
        model.browse.readerTabId = model.tabs.selectedTabId
        settle()
        assertFalse(controller.isAppearanceLightStatusBars)
        model.browse.readerTabId = null
        settle()
        assertTrue(controller.isAppearanceLightStatusBars)
    }

    @Test
    fun aLightReaderUsesDarkIconsAndADarkReaderLightOnes() {
        assertTrue(ReaderTheme.Light.usesDarkStatusIcons)
        assertTrue(ReaderTheme.Sepia.usesDarkStatusIcons)
        assertFalse(ReaderTheme.Dark.usesDarkStatusIcons)
    }

    private companion object {
        const val TIMEOUT = 20_000L
    }
}
