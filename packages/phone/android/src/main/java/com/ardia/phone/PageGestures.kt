package com.ardia.phone

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import com.ardia.browser.Page
import com.ardia.browsing.PageSwipe
import com.ardia.browsing.PullToRefreshRules
import com.ardia.browsing.SwipeDirection
import kotlin.math.hypot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

enum class SwipeMode(val raw: String) {
    Anywhere("anywhere"),
    Edges("edges"),
    Off("off");

    companion object {
        fun of(raw: String?): SwipeMode = entries.firstOrNull { it.raw == raw } ?: Off
    }
}

internal object PageDragDecision {
    enum class Drag { Swipe, Pull }

    data class Decided(val drag: Drag, val direction: SwipeDirection?)

    fun decide(
        mode: SwipeMode,
        pullToRefresh: Boolean,
        dx: Float,
        dy: Float,
        startX: Float,
        width: Float,
        edge: Float,
        canGoBack: Boolean,
        canGoForward: Boolean,
        canScrollLeft: Boolean,
        canScrollRight: Boolean,
        canScrollUp: Boolean,
        isLoading: Boolean,
    ): Decided? {
        if (mode != SwipeMode.Off) {
            val direction = PageSwipe.direction(mode == SwipeMode.Edges, dx, dy, startX, width, edge, canGoBack, canGoForward, canScrollLeft, canScrollRight)
            if (direction != null) return Decided(Drag.Swipe, direction)
        }
        if (pullToRefresh && !isLoading && PullToRefreshRules.begins(dx, dy, canScrollUp)) return Decided(Drag.Pull, null)
        return null
    }
}

internal class PageGestures(private val owner: ViewGroup, private val host: View) {
    private val context: Context = owner.context
    private val density = context.resources.displayMetrics.density
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private val backTarget = Target(context)
    private val forwardTarget = Target(context)
    private val pageShade = View(context).apply { setBackgroundColor(Color.BLACK); alpha = 0f; visibility = View.GONE }
    private val indicator = RefreshIndicator(context)
    private var scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    var mode: SwipeMode = SwipeMode.Off
    var pullToRefresh: Boolean = false
    var page: Page? = null

    private var downX = 0f
    private var downY = 0f
    private var deciding = false
    private var decided: PageDragDecision.Decided? = null
    private var activationX = 0f
    private var activationY = 0f
    private var tracker: VelocityTracker? = null
    private var direction: SwipeDirection? = null
    private var progress = 0f
    private var pull = 0f
    private var crossed = false
    private var busy = false
    private var settle: Job? = null

    fun install() {
        val match = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        owner.addView(backTarget, 0, match)
        owner.addView(pageShade, FrameLayout.LayoutParams(match))
        owner.addView(forwardTarget, FrameLayout.LayoutParams(match))
        val side = (INDICATOR_DP * density).toInt()
        owner.addView(indicator, FrameLayout.LayoutParams(side, side))
        forwardTarget.elevation = 12 * density
        reset()
    }

    fun layout(width: Int, height: Int) {
        for (view in listOf(backTarget, pageShade, forwardTarget)) {
            view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
            view.layout(0, 0, width, height)
        }
        val side = (INDICATOR_DP * density).toInt()
        indicator.measure(View.MeasureSpec.makeMeasureSpec(side, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(side, View.MeasureSpec.EXACTLY))
        val left = (width - side) / 2
        indicator.layout(left, 0, left + side, side)
    }

    fun intercepts(event: MotionEvent): Boolean {
        val current = page ?: return false
        if (mode == SwipeMode.Off && !pullToRefresh) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                deciding = !busy
                decided = null
                downX = event.x
                downY = event.y
                tracker?.recycle()
                tracker = VelocityTracker.obtain().also { it.addMovement(event) }
            }
            MotionEvent.ACTION_POINTER_DOWN -> deciding = false
            MotionEvent.ACTION_MOVE -> {
                if (!deciding) return false
                tracker?.addMovement(event)
                val dx = event.x - downX
                val dy = event.y - downY
                if (hypot(dx, dy) < slop) return false
                deciding = false
                val state = current.state.value
                val web = current.view.value
                val choice = PageDragDecision.decide(
                    mode = mode,
                    pullToRefresh = pullToRefresh,
                    dx = dx,
                    dy = dy,
                    startX = downX,
                    width = owner.width.toFloat(),
                    edge = PageSwipe.EDGE_DP * density,
                    canGoBack = state.canGoBack,
                    canGoForward = state.canGoForward,
                    canScrollLeft = web?.canScrollHorizontally(-1) == true,
                    canScrollRight = web?.canScrollHorizontally(1) == true,
                    canScrollUp = web?.canScrollVertically(-1) == true || !state.isScrolledToTop,
                    isLoading = state.isLoading,
                ) ?: return false
                decided = choice
                activationX = dx
                activationY = dy
                if (choice.drag == PageDragDecision.Drag.Swipe) beginSwipe(choice.direction!!, state.backgroundColor) else beginPull()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> deciding = false
        }
        return false
    }

    fun touch(event: MotionEvent): Boolean {
        val choice = decided ?: return false
        val current = page
        tracker?.addMovement(event)
        val dx = event.x - downX - activationX
        val dy = event.y - downY - activationY
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (choice.drag == PageDragDecision.Drag.Swipe) followSwipe(dx) else followPull(dy / density)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                decided = null
                val ended = event.actionMasked == MotionEvent.ACTION_UP
                if (choice.drag == PageDragDecision.Drag.Swipe) {
                    tracker?.computeCurrentVelocity(1000)
                    val velocity = tracker?.xVelocity ?: 0f
                    val swiped = direction
                    val commits = ended && swiped != null && current != null &&
                        PageSwipe.commits(PageSwipe.signed(dx, swiped), PageSwipe.signed(velocity, swiped), PageSwipe.COMMIT_DP * density, PageSwipe.FLICK_COMMIT_DP * density)
                    finishSwipe(commits, current)
                } else {
                    finishPull(current)
                }
                tracker?.recycle()
                tracker = null
            }
        }
        return true
    }

    fun detach() {
        scope.cancel()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        reset()
    }

    private fun beginSwipe(swiped: SwipeDirection, background: Int?) {
        settle?.cancel()
        busy = true
        direction = swiped
        val color = background ?: surface()
        backTarget.setColor(color)
        forwardTarget.setColor(color)
        backTarget.alpha = 1f
        forwardTarget.alpha = 1f
        backTarget.visibility = if (swiped == SwipeDirection.Back) View.VISIBLE else View.GONE
        forwardTarget.visibility = if (swiped == SwipeDirection.Forward) View.VISIBLE else View.GONE
        pageShade.visibility = if (swiped == SwipeDirection.Forward) View.VISIBLE else View.GONE
        pose(0f)
    }

    private fun followSwipe(translation: Float) {
        val swiped = direction ?: return
        pose(PageSwipe.progress(translation, swiped, owner.width.toFloat()))
    }

    private fun pose(value: Float) {
        progress = value
        val width = owner.width.toFloat()
        when (direction) {
            SwipeDirection.Back -> {
                host.translationX = width * value
                backTarget.translationX = -width * PageSwipe.PARALLAX * (1f - value)
                backTarget.shade(PageSwipe.SHADE * (1f - value))
            }
            SwipeDirection.Forward -> {
                host.translationX = -width * PageSwipe.PARALLAX * value
                pageShade.translationX = host.translationX
                pageShade.alpha = PageSwipe.SHADE * value
                forwardTarget.translationX = width * (1f - value)
            }
            null -> host.translationX = 0f
        }
    }

    private fun finishSwipe(commit: Boolean, current: Page?) {
        val swiped = direction ?: return
        animate(progress, if (commit) 1f else 0f, SWIPE_MILLIS, ::pose) {
            if (!commit || current == null) {
                reset()
                return@animate
            }
            if (swiped == SwipeDirection.Back) current.goBack() else current.goForward()
            host.translationX = 0f
            pageShade.visibility = View.GONE
            val target = if (swiped == SwipeDirection.Back) backTarget else forwardTarget
            target.translationX = 0f
            target.shade(0f)
            settle = scope.launch {
                delay(SETTLE_DELAY_MILLIS)
                animate(1f, 0f, FADE_MILLIS, { target.alpha = it }) { reset() }
            }
        }
    }

    private fun beginPull() {
        busy = true
        crossed = false
        indicator.visibility = View.VISIBLE
        indicator.refreshing = false
        showPull(0f)
    }

    private fun followPull(pulledDp: Float) {
        showPull(PullToRefreshRules.distance(pulledDp))
        val past = PullToRefreshRules.triggers(pull)
        if (past && !crossed) owner.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
        crossed = past
    }

    private fun showPull(distance: Float) {
        pull = distance
        host.translationY = distance * density
        indicator.translationY = (distance - PullToRefreshRules.HOLD_DP) / 2f * density + 8 * density
        indicator.turn = (distance / PullToRefreshRules.TRIGGER_DP).coerceIn(0f, 1f)
        indicator.alpha = if (indicator.refreshing) 1f else (distance / PullToRefreshRules.TRIGGER_DP).coerceIn(0.2f, 1f)
        if (distance <= 0.5f && !indicator.refreshing) indicator.visibility = View.INVISIBLE else indicator.visibility = View.VISIBLE
    }

    private fun finishPull(current: Page?) {
        if (current == null || !PullToRefreshRules.triggers(pull)) {
            animate(pull, 0f, PULL_MILLIS, ::showPull) { reset() }
            return
        }
        indicator.refreshing = true
        current.reload()
        animate(pull, PullToRefreshRules.HOLD_DP, PULL_MILLIS, ::showPull) {
            settle = scope.launch {
                withTimeoutOrNull(PullToRefreshRules.TIMEOUT_MILLIS) {
                    current.state.first { it.isLoading }
                    current.state.first { !it.isLoading }
                }
                indicator.refreshing = false
                animate(pull, 0f, PULL_MILLIS, ::showPull) { reset() }
            }
        }
    }

    private fun animate(from: Float, to: Float, millis: Long, step: (Float) -> Unit, done: () -> Unit) {
        ValueAnimator.ofFloat(from, to).apply {
            duration = millis
            addUpdateListener { step(it.animatedValue as Float) }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) = done()
            })
            start()
        }
    }

    private fun reset() {
        busy = false
        direction = null
        progress = 0f
        pull = 0f
        host.translationX = 0f
        host.translationY = 0f
        backTarget.visibility = View.GONE
        forwardTarget.visibility = View.GONE
        pageShade.visibility = View.GONE
        indicator.refreshing = false
        indicator.visibility = View.INVISIBLE
    }

    private fun surface(): Int = if (isDark()) Color.BLACK else Color.WHITE

    private fun isDark(): Boolean = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES

    private class Target(context: Context) : FrameLayout(context) {
        private val shadeView = View(context).apply { setBackgroundColor(Color.BLACK); alpha = 0f }

        init {
            visibility = GONE
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            addView(shadeView, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }

        fun setColor(color: Int) = setBackgroundColor(color)

        fun shade(amount: Float) {
            shadeView.alpha = amount
        }
    }

    private class RefreshIndicator(context: Context) : View(context) {
        private val density = context.resources.displayMetrics.density
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2 * density
            strokeCap = Paint.Cap.ROUND
        }
        private val head = Path()
        private val bounds = RectF()
        private var spin: ValueAnimator? = null
        private var spinAngle = 0f

        var turn: Float = 0f
            set(value) {
                field = value
                invalidate()
            }

        var refreshing: Boolean = false
            set(value) {
                if (field == value) return
                field = value
                spin?.cancel()
                spin = if (value) {
                    ValueAnimator.ofFloat(0f, 360f).apply {
                        duration = 900
                        repeatCount = ValueAnimator.INFINITE
                        interpolator = android.view.animation.LinearInterpolator()
                        addUpdateListener {
                            spinAngle = it.animatedValue as Float
                            invalidate()
                        }
                        start()
                    }
                } else {
                    null
                }
                invalidate()
            }

        init {
            visibility = INVISIBLE
            contentDescription = context.getString(com.ardia.browser.R.string.phone_reloading)
        }

        override fun onDraw(canvas: Canvas) {
            val dark = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
            paint.color = if (dark) ACCENT_DARK else ACCENT_LIGHT
            val inset = 6 * density
            bounds.set(inset, inset, width - inset, height - inset)
            if (refreshing) {
                canvas.drawArc(bounds, spinAngle, 270f, false, paint)
                return
            }
            canvas.save()
            canvas.rotate(turn * 300f, width / 2f, height / 2f)
            canvas.drawArc(bounds, -60f, 300f, false, paint)
            val radius = bounds.width() / 2f
            val endX = width / 2f + radius * kotlin.math.cos(Math.toRadians(-60.0)).toFloat()
            val endY = height / 2f + radius * kotlin.math.sin(Math.toRadians(-60.0)).toFloat()
            head.reset()
            head.moveTo(endX - 4 * density, endY - 1 * density)
            head.lineTo(endX, endY)
            head.lineTo(endX - 1 * density, endY + 4 * density)
            canvas.drawPath(head, paint)
            canvas.restore()
        }

        override fun onDetachedFromWindow() {
            spin?.cancel()
            super.onDetachedFromWindow()
        }
    }

    private companion object {
        const val INDICATOR_DP = 28f
        const val SWIPE_MILLIS = 220L
        const val SETTLE_DELAY_MILLIS = 250L
        const val FADE_MILLIS = 200L
        const val PULL_MILLIS = 250L
        val ACCENT_LIGHT = 0xFF007AFF.toInt()
        val ACCENT_DARK = 0xFF0A84FF.toInt()
    }
}
