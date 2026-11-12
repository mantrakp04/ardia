package com.ardia.browser

import android.content.Context
import android.graphics.Bitmap
import android.view.View
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

data class PageSetup(
    val url: String? = null,
    val title: String = "",
    val isPrivate: Boolean = false,
    val savedState: ByteArray? = null,
) {
    override fun equals(other: Any?): Boolean = other is PageSetup && url == other.url && title == other.title &&
        isPrivate == other.isPrivate && savedState.contentEquals(other.savedState)

    override fun hashCode(): Int = listOf(url, title, isPrivate, savedState?.contentHashCode()).hashCode()
}

interface Page : AutoCloseable {
    val id: String
    val isPrivate: Boolean
    val state: StateFlow<PageState>
    val view: StateFlow<View?>
    val request: StateFlow<PageRequest?>
    val find: StateFlow<FindResult?>
    val fullscreen: StateFlow<FullscreenVideo?>
    val events: SharedFlow<PageEvent>

    fun load(url: String)

    fun reload()

    fun stop()

    fun goBack(): Boolean

    fun goForward(): Boolean

    fun find(text: String)

    fun findNext()

    fun findPrevious()

    fun endFind()

    fun setPageZoom(zoom: Double)

    fun zoomIn()

    fun zoomOut()

    fun setDesktopSite(enabled: Boolean)

    fun download(url: String)

    suspend fun readableContent(): ReadableContent

    suspend fun snapshot(maxWidth: Int = SNAPSHOT_WIDTH): Bitmap?

    suspend fun sampleTone(topInset: Int, bottomInset: Int): PageTone?

    fun saveState(): ByteArray?

    companion object {
        const val SNAPSHOT_WIDTH = 600
    }
}

interface PageEngine {
    val name: String
    val isDevelopmentOnly: Boolean
    val separatesPrivatePages: Boolean
    val livePageIds: List<String>
    var filter: PageFilter?
    var isInspectable: Boolean
    var onPrivateBrowsingEnded: (() -> Unit)?

    fun open(id: String, setup: PageSetup): Page

    fun openPopup(id: String, popup: PopupRequest): Page

    fun existing(id: String): Page?

    fun close(id: String)

    fun discardBackgroundPages()

    fun refreshSitePreferences()

    fun attach(activity: Context)

    fun detach(activity: Context)

    fun warmUp()

    suspend fun clearWebsiteData(kinds: Set<WebsiteDataKind>)
}
