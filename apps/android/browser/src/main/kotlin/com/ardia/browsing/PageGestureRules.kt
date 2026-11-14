package com.ardia.browsing

import kotlin.math.abs
import kotlin.math.max

enum class SwipeDirection { Back, Forward }

object PageSwipe {
    const val DOMINANCE = 1.6f
    const val HYSTERESIS_DP = 12f
    const val EDGE_DP = 24f
    const val SHADE = 0.12f
    const val PARALLAX = 0.33f
    const val COMMIT_DP = 75f
    const val FLICK_COMMIT_DP = 50f

    fun direction(
        edgesOnly: Boolean,
        dx: Float,
        dy: Float,
        startX: Float,
        width: Float,
        edge: Float,
        canGoBack: Boolean,
        canGoForward: Boolean,
        canScrollLeft: Boolean,
        canScrollRight: Boolean,
    ): SwipeDirection? {
        if (abs(dx) <= abs(dy) * DOMINANCE) return null
        val wanted = if (dx > 0) SwipeDirection.Back else SwipeDirection.Forward
        if (edgesOnly) {
            val fromEdge = if (wanted == SwipeDirection.Back) startX <= edge else startX >= width - edge
            if (!fromEdge) return null
        }
        return when (wanted) {
            SwipeDirection.Back -> SwipeDirection.Back.takeIf { canGoBack && !canScrollLeft }
            SwipeDirection.Forward -> SwipeDirection.Forward.takeIf { canGoForward && !canScrollRight }
        }
    }

    fun signed(translation: Float, direction: SwipeDirection): Float = if (direction == SwipeDirection.Back) translation else -translation

    fun progress(translation: Float, direction: SwipeDirection, width: Float): Float =
        (signed(translation, direction) / max(width, 1f)).coerceIn(0f, 1f)

    fun isPastCommit(signed: Float, wasPast: Boolean, commit: Float, hysteresis: Float): Boolean =
        if (wasPast) signed > commit - hysteresis else signed > commit

    fun commits(signed: Float, signedVelocity: Float, commit: Float, flick: Float): Boolean =
        signed > commit && signedVelocity > -50f || signed > flick && signedVelocity > 600f
}

object PullToRefreshRules {
    const val TRIGGER_DP = 64f
    const val LIMIT_DP = 130f
    const val DOMINANCE = 1.2f
    const val HOLD_DP = 56f
    const val TIMEOUT_MILLIS = 8_000L

    fun begins(dx: Float, dy: Float, canScrollUp: Boolean): Boolean = dy > 0f && dy > abs(dx) * DOMINANCE && !canScrollUp

    fun distance(pulled: Float): Float {
        if (pulled <= 0f) return 0f
        return LIMIT_DP * (1f - 1f / (pulled / LIMIT_DP + 1f))
    }

    fun triggers(distance: Float): Boolean = distance >= TRIGGER_DP
}
