package com.ardia.tabs

import android.content.Context
import android.graphics.Bitmap
import android.view.View
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
import com.ardia.browser.ReadableContent
import com.ardia.browser.WebsiteDataKind
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

class StillPage(override val id: String, setup: PageSetup) : Page {
    override val isPrivate: Boolean = setup.isPrivate
    override val state: StateFlow<PageState> = MutableStateFlow(PageState(url = setup.url, title = setup.title))
    override val view: StateFlow<View?> = MutableStateFlow(null)
    override val request: StateFlow<PageRequest?> = MutableStateFlow(null)
    override val find: StateFlow<FindResult?> = MutableStateFlow(null)
    override val fullscreen: StateFlow<FullscreenVideo?> = MutableStateFlow(null)
    override val events: SharedFlow<PageEvent> = MutableSharedFlow()

    override fun load(url: String) = Unit

    override fun reload() = Unit

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

    override fun setDesktopSite(enabled: Boolean) = Unit

    override fun download(url: String) = Unit

    override suspend fun readableContent(): ReadableContent = throw UnsupportedOperationException()

    override suspend fun snapshot(maxWidth: Int): Bitmap? = null

    override suspend fun sampleTone(topInset: Int, bottomInset: Int): PageTone? = null

    override fun saveState(): ByteArray? = null

    override fun close() = Unit
}

class StillPageEngine : PageEngine {
    private val pages = LinkedHashMap<String, StillPage>()
    override val name: String = "still"
    override val isDevelopmentOnly: Boolean = true
    override val separatesPrivatePages: Boolean = false
    override val livePageIds: List<String> get() = pages.keys.toList()
    override var filter: PageFilter? = null
    override var privateFilter: PageFilter? = null
    override var isInspectable: Boolean = false
    override var onPrivateBrowsingEnded: (() -> Unit)? = null

    override fun open(id: String, setup: PageSetup): Page = pages.getOrPut(id) { StillPage(id, setup) }

    override fun openPopup(id: String, popup: PopupRequest): Page = open(id, PageSetup(url = popup.url, isPrivate = popup.isPrivate))

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
