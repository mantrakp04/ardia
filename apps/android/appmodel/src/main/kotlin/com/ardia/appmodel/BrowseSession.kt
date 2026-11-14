package com.ardia.appmodel

import android.graphics.Bitmap
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.browser.PageTone
import com.ardia.browser.PressTarget
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Stable
class BrowseSession(private val scope: CoroutineScope) {
    enum class SearchOrigin { Home, Start, Page }

    data class SearchRequest(val origin: SearchOrigin, val initialText: String, val selectsAll: Boolean, val incognitoOnCancel: Boolean?)

    data class StepRequest(val delta: Int, val id: Long = nextId.incrementAndGet())

    data class PagePress(val tabId: String, val target: PressTarget, val x: Float, val y: Float)

    var search: SearchRequest? by mutableStateOf(null)
    var trayHoldsKeyboard: Boolean by mutableStateOf(false)
    var isToolbarPresented: Boolean by mutableStateOf(false)
    var readerTabId: String? by mutableStateOf(null)
    var titleFeedback: String? by mutableStateOf(null)
        private set
    var isVoicePresented: Boolean by mutableStateOf(false)
    var isFindPresented: Boolean by mutableStateOf(false)
    var desktopTabs: Set<String> by mutableStateOf(emptySet())
    var stepRequest: StepRequest? by mutableStateOf(null)
    var deckRequested: Boolean by mutableStateOf(false)
    var press: PagePress? by mutableStateOf(null)
    val tones = mutableStateMapOf<String, PageTone>()

    val covers = PageCoverCache()

    var frozenOrder: List<String>? = null
        private set
    private var unfreezeJob: Job? = null
    private var feedbackJob: Job? = null

    fun presentSearch(from: SearchOrigin, text: String = "", selectsAll: Boolean = false, incognitoOnCancel: Boolean? = null) {
        if (search != null) return
        search = SearchRequest(from, text, selectsAll, incognitoOnCancel)
    }

    fun dismissSearch() {
        search = null
    }

    fun freezeOrder(ids: List<String>) {
        if (frozenOrder == null) frozenOrder = ids
        unfreezeJob?.cancel()
        unfreezeJob = scope.launch {
            delay(ORDER_FREEZE_MILLIS)
            frozenOrder = null
        }
    }

    fun thawOrder() {
        unfreezeJob?.cancel()
        unfreezeJob = null
        frozenOrder = null
    }

    fun setTone(tone: PageTone, id: String) {
        if (tones[id] != tone) tones[id] = tone
    }

    fun showTitleFeedback(text: String, durationMillis: Long = FEEDBACK_MILLIS) {
        feedbackJob?.cancel()
        titleFeedback = text
        feedbackJob = scope.launch {
            delay(durationMillis)
            titleFeedback = null
        }
    }

    internal fun forget(id: String) {
        covers.forget(id)
        tones.remove(id)
        if (id in desktopTabs) desktopTabs = desktopTabs - id
        if (readerTabId == id) readerTabId = null
        if (press?.tabId == id) press = null
    }

    companion object {
        const val ORDER_FREEZE_MILLIS = 4_000L
        const val FEEDBACK_MILLIS = 1_000L
        private val nextId = AtomicLong()
    }
}

class PageCoverCache(private val limit: Int = LIMIT) {
    private val images = HashMap<String, Bitmap>()
    private val order = ArrayList<String>()

    fun image(id: String): Bitmap? = images[id]

    fun store(image: Bitmap, id: String) {
        images[id] = image
        order.remove(id)
        order.add(id)
        while (order.size > limit) images.remove(order.removeAt(0))
    }

    fun forget(id: String) {
        images.remove(id)
        order.remove(id)
    }

    companion object {
        const val LIMIT = 8
    }
}
