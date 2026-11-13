package com.ardia.appmodel

import android.content.Context
import android.graphics.Bitmap
import android.os.Looper
import android.view.View
import androidx.test.core.app.ApplicationProvider
import com.ardia.blocking.FilterLists
import com.ardia.blocking.InMemoryBlockingStore
import com.ardia.browser.DownloadOutcome
import com.ardia.browser.FindResult
import com.ardia.browser.FullscreenVideo
import com.ardia.browser.Page
import com.ardia.browser.PageDownload
import com.ardia.browser.PageEngine
import com.ardia.browser.PageEvent
import com.ardia.browser.PageFilter
import com.ardia.browser.PageRequest
import com.ardia.browser.PageSetup
import com.ardia.browser.PageState
import com.ardia.browser.PageTone
import com.ardia.browser.PopupRequest
import com.ardia.browser.ReadableContent
import com.ardia.browser.ReadableContentException
import com.ardia.browser.SitePreferences
import com.ardia.browser.WebsiteDataKind
import com.ardia.store.BrowserStore
import com.ardia.store.CoreScript
import com.ardia.store.MemoryKeyValueStore
import com.ardia.sync.SyncController
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.fail
import org.robolectric.Shadows.shadowOf

class FakePage(override val id: String, setup: PageSetup) : Page {
    override val isPrivate: Boolean = setup.isPrivate
    val mutableState = MutableStateFlow(PageState(url = setup.url, title = setup.title, isLive = true))
    val mutableEvents = MutableSharedFlow<PageEvent>(replay = 16, extraBufferCapacity = 16)
    val loads = ArrayList<String>()
    var reloads = 0
    var desktop = false
    var closed = false
    var savedState: ByteArray? = setup.savedState
    val restoredFrom: ByteArray? = setup.savedState

    init {
        val url = setup.url
        if (url != null && setup.savedState == null && setup.firstVisit != com.ardia.browser.VisitKind.Restored) {
            mutableEvents.tryEmit(PageEvent.Visited(url, setup.title, setup.firstVisit))
        }
    }

    override val state: StateFlow<PageState> = mutableState
    override val view: StateFlow<View?> = MutableStateFlow(null)
    override val request: StateFlow<PageRequest?> = MutableStateFlow(null)
    override val find: StateFlow<FindResult?> = MutableStateFlow(null)
    override val fullscreen: StateFlow<FullscreenVideo?> = MutableStateFlow(null)
    override val events: SharedFlow<PageEvent> = mutableEvents

    fun visit(url: String, title: String, kind: com.ardia.browser.VisitKind = com.ardia.browser.VisitKind.Link) {
        mutableState.value = mutableState.value.copy(url = url, title = title)
        mutableEvents.tryEmit(PageEvent.Visited(url, title, kind))
    }

    override fun load(url: String) {
        loads += url
    }

    override fun reload() {
        reloads += 1
    }

    override fun stop() = Unit

    override fun goBack(): Boolean = false

    override fun goForward(): Boolean = false

    override fun find(text: String) = Unit

    override fun findNext() = Unit

    override fun findPrevious() = Unit

    override fun endFind() = Unit

    override fun setPageZoom(zoom: Double) = Unit

    override fun zoomIn() = Unit

    override fun zoomOut() = Unit

    override fun setDesktopSite(enabled: Boolean) {
        desktop = enabled
    }

    override fun download(url: String) = Unit

    override suspend fun readableContent(): ReadableContent = throw ReadableContentException(ReadableContentException.Reason.PageNotLoaded)

    override suspend fun snapshot(maxWidth: Int): Bitmap? = Bitmap.createBitmap(4, 8, Bitmap.Config.ARGB_8888)

    override suspend fun sampleTone(topInset: Int, bottomInset: Int): PageTone? = null

    override fun saveState(): ByteArray? = savedState

    override fun close() {
        closed = true
    }
}

class FakeEngine(val sitePreferences: SitePreferences, override val separatesPrivatePages: Boolean = true) : PageEngine {
    val pages = LinkedHashMap<String, FakePage>()
    val opened = ArrayList<String>()
    val closed = ArrayList<String>()
    val cleared = ArrayList<Set<WebsiteDataKind>>()
    var refreshes = 0

    override val name: String = "Fake"
    override val isDevelopmentOnly: Boolean = true
    override val livePageIds: List<String> get() = pages.keys.toList()
    override var filter: PageFilter? = null
    override var privateFilter: PageFilter? = null
    override var isInspectable: Boolean = false
    override var onPrivateBrowsingEnded: (() -> Unit)? = null

    override fun open(id: String, setup: PageSetup): Page {
        if (setup.isPrivate && !separatesPrivatePages && id !in pages) throw com.ardia.browser.PrivatePagesUnavailableException()
        opened += id
        return pages.getOrPut(id) { FakePage(id, setup) }
    }

    override fun openPopup(id: String, popup: PopupRequest): Page = open(id, PageSetup(popup.url, isPrivate = popup.isPrivate))

    override fun existing(id: String): Page? = pages[id]

    override fun close(id: String) {
        closed += id
        val page = pages.remove(id) ?: return
        page.closed = true
        if (page.isPrivate && pages.values.none { it.isPrivate }) onPrivateBrowsingEnded?.invoke()
    }

    override fun discardBackgroundPages() = Unit

    override fun refreshSitePreferences() {
        refreshes += 1
    }

    override fun attach(activity: Context) = Unit

    override fun detach(activity: Context) = Unit

    override fun warmUp() = Unit

    override suspend fun clearWebsiteData(kinds: Set<WebsiteDataKind>) {
        cleared += kinds
    }
}

class FakeSystem : SystemActions {
    val copies = ArrayList<String>()
    val shares = ArrayList<String>()
    val externals = ArrayList<String>()
    val downloads = ArrayList<PageDownload>()
    val outcomes = MutableSharedFlow<DownloadOutcome>(extraBufferCapacity = 4)
    var acceptsDownloads = true

    override val downloadOutcomes = outcomes
    override val activeDownloads = MutableStateFlow<List<com.ardia.browser.DownloadProgress>>(emptyList())

    override fun copyText(text: String) {
        copies += text
    }

    override fun share(url: String, title: String) {
        shares += url
    }

    val textShares = ArrayList<String>()

    val textSubjects = ArrayList<String?>()

    override fun shareText(text: String, subject: String?) {
        textShares += text
        textSubjects += subject
    }

    var roleRequest: android.content.Intent? = null

    override fun browserRoleRequest(): android.content.Intent? = roleRequest

    override fun defaultAppsSettings(): android.content.Intent = android.content.Intent("settings.DEFAULT_APPS")

    override fun openExternal(url: String): Boolean {
        externals += url
        return true
    }

    override fun openDownloaded(outcome: DownloadOutcome.Finished) = Unit

    val cancelled = ArrayList<Long>()

    override fun enqueueDownload(download: PageDownload): Long? {
        downloads += download
        return if (acceptsDownloads) downloads.size.toLong() else null
    }

    override fun cancelDownload(id: Long) {
        cancelled += id
        activeDownloads.value = activeDownloads.value.filterNot { it.id == id }
    }

    override fun isDefaultBrowser(): Boolean? = false

    override fun preferredLanguage(): String = "de"
}

open class SilentCoreScript : CoreScript {
    override fun call(function: String, arguments: List<String>): String = "null"
}

class RecordingCoreScript : SilentCoreScript(), AutoCloseable {
    val calls: MutableList<Pair<String, List<String>>> = java.util.Collections.synchronizedList(ArrayList())

    @Volatile
    var closed = false

    override fun call(function: String, arguments: List<String>): String {
        calls += function to arguments
        return "null"
    }

    override fun close() {
        closed = true
    }
}

class AppModelFixture(
    launch: LaunchArguments = LaunchArguments.none,
    demo: Boolean = false,
    openStore: (suspend (Context) -> BrowserStore)? = null,
    private val separatesPrivatePages: Boolean = true,
    val script: RecordingCoreScript = RecordingCoreScript(),
) {
    val context: Context = ApplicationProvider.getApplicationContext()
    val system = FakeSystem()
    var engine: FakeEngine? = null
    val app: AppModel

    init {
        val scratch = File(context.cacheDir, "fixture-filters")
        val environment = if (demo) {
            val real = AppEnvironment.forApp(context, isDemo = true)
            AppEnvironment(
                isDemo = true,
                preferences = real.preferences,
                blockingStore = real.blockingStore,
                openStore = real.openStore,
                makeEngine = { FakeEngine(it, separatesPrivatePages).also { made -> engine = made } },
                makeSync = real.makeSync,
                makeFilterLists = real.makeFilterLists,
                coreScript = { script },
                omniboxDirectory = real.omniboxDirectory,
                system = system,
            )
        } else {
            AppEnvironment(
                isDemo = false,
                preferences = MemoryKeyValueStore(),
                blockingStore = InMemoryBlockingStore(),
                openStore = { openStore?.invoke(context) ?: BrowserStore.open(context, callbackDispatcher = Dispatchers.Main) },
                makeEngine = { FakeEngine(it, separatesPrivatePages).also { made -> engine = made } },
                makeSync = { SyncController.demo() },
                makeFilterLists = { FilterLists.demo(scratch, it) },
                coreScript = { script },
                omniboxDirectory = null,
                system = system,
            )
        }
        app = AppModel(launch.copy(isDemo = demo), environment)
    }

    val fakeEngine: FakeEngine get() = engine ?: (app.web as FakeEngine)

    fun page(id: String): FakePage = fakeEngine.pages[id] ?: error("no page for $id")

    fun ready(): AppModelFixture {
        idleUntil(timeoutMillis = 30_000) { app.isReady }
        return this
    }

    fun close() {
        app.close()
    }
}

fun idle() {
    shadowOf(Looper.getMainLooper()).idle()
}

fun idleUntil(timeoutMillis: Long = 10_000, condition: () -> Boolean) {
    val end = System.currentTimeMillis() + timeoutMillis
    while (true) {
        idle()
        if (condition()) return
        if (System.currentTimeMillis() > end) fail("condition not met within $timeoutMillis ms")
        Thread.sleep(10)
    }
}
