package com.ardia.phone

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.ardia.browser.Page
import com.ardia.browser.PageColors
import com.ardia.browser.PageState
import com.ardia.browser.PageTone
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class PageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onPageEvent by EventDispatcher()
    private val host = FrameLayout(context)
    private var scope: CoroutineScope? = null
    private var sampled: PageTone? = null
    private var sentTone: PageTone? = null
    private var failedId: String? = null

    var pageId: String? = null
    var initialUrl: String? = null
    var title: String? = null
    var isPrivate: Boolean = false
    var savedState: String? = null
    var toneInsets: Pair<Double, Double> = 0.0 to 0.0
    var page: Page? = null
        private set

    private val gestures = PageGestures(this, host)

    var swipeMode: SwipeMode
        get() = gestures.mode
        set(value) {
            gestures.mode = value
        }

    var pullToRefresh: Boolean
        get() = gestures.pullToRefresh
        set(value) {
            gestures.pullToRefresh = value
        }

    init {
        addView(host, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        gestures.install()
    }

    override fun requestDisallowInterceptTouchEvent(disallow: Boolean) {
        super.requestDisallowInterceptTouchEvent(disallow)
        if (disallow) gestures.contentTookTheDrag()
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean = gestures.intercepts(event) || super.onInterceptTouchEvent(event)

    override fun onTouchEvent(event: MotionEvent): Boolean = gestures.touch(event) || super.onTouchEvent(event)

    fun bind() {
        val id = pageId ?: return
        if (page?.id == id || failedId == id) return
        unbind()
        val opened = try {
            PhonePages.open(context, id, PhonePages.setup(initialUrl, title, isPrivate, savedState))
        } catch (error: CodedException) {
            failedId = id
            onPageEvent(mapOf("name" to "error", "code" to error.code, "message" to (error.message ?: error.code)))
            return
        }
        page = opened
        gestures.page = opened
        PhonePages.viewShows(id, this)
        val running = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = running
        running.launch { opened.view.collect(::show) }
        running.launch { opened.state.collect(::sendState) }
        running.launch { sampleTone(opened) }
    }

    fun unbind() {
        page?.id?.let { PhonePages.viewLeaves(it, this) }
        scope?.cancel()
        scope = null
        page = null
        gestures.page = null
        gestures.detach()
        failedId = null
        sampled = null
        sentTone = null
        host.removeAllViews()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        page?.id?.let(PhonePages::activate)
    }

    private fun show(view: View?) {
        if (view != null && view.parent === host && host.childCount == 1) return
        host.removeAllViews()
        if (view == null) return
        (view.parent as? ViewGroup)?.removeView(view)
        host.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        layOutChildren()
    }

    private val layOutAgain = Runnable { layOutChildren() }

    private fun layOutChildren() {
        if (width == 0 || height == 0) return
        host.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        host.layout(0, 0, width, height)
        gestures.layout(width, height)
    }

    override fun requestLayout() {
        super.requestLayout()
        @Suppress("SENSELESS_COMPARISON")
        if (layOutAgain != null) post(layOutAgain)
    }

    private fun sendState(state: PageState) {
        onPageEvent(present(mapOf("name" to "state") + PagePayloads.state(context, state, page?.isPrivate ?: isPrivate)))
        sendTone(state)
    }

    private fun present(fields: Map<String, Any?>): Map<String, Any> = buildMap { fields.forEach { (key, value) -> if (value != null) put(key, value) } }

    private fun sendTone(state: PageState) {
        val tone = PageTone.resolve(state.themeColor, state.backgroundColor, sampled, stored = null)
        if (tone == sentTone || (tone.top == null && tone.bottom == null)) return
        sentTone = tone
        onPageEvent(
            buildMap {
                put("name", "tone")
                tone.top?.let { put("top", PageColors.hex(it)) }
                tone.bottom?.let { put("bottom", PageColors.hex(it)) }
            },
        )
    }

    private suspend fun sampleTone(page: Page) {
        page.state.map { Triple(it.isLoading, it.scrollDirection, it.isScrolledToTop) }.distinctUntilChanged().collectLatest { (loading, _, _) ->
            if (loading) return@collectLatest
            delay(TONE_SETTLE_MILLIS)
            val density = resources.displayMetrics.density
            val (top, bottom) = toneInsets
            sampled = page.sampleTone((top * density).roundToInt(), (bottom * density).roundToInt()) ?: return@collectLatest
            sendTone(page.state.value)
        }
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        host.layout(0, 0, r - l, b - t)
        gestures.layout(r - l, b - t)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        host.measure(
            MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY),
        )
    }

    private companion object {
        const val TONE_SETTLE_MILLIS = 250L
    }
}
