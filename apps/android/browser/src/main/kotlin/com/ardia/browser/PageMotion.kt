package com.ardia.browser

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

enum class ScrollDirection {
    Up,
    Down,
}

class ProgressThrottle(private val minimumIntervalMillis: Long = 100) {
    var published = 0f
        private set
    private var lastPublish = Long.MIN_VALUE / 2

    fun offer(raw: Double, nowMillis: Long): Float? {
        val whole = (floor(max(0.0, min(1.0, raw)) * 100) / 100).toFloat()
        if (whole == published) return null
        val finishing = whole >= 1f || whole == 0f
        if (!finishing && nowMillis - lastPublish < minimumIntervalMillis) return null
        published = whole
        lastPublish = nowMillis
        return whole
    }

    fun reset() {
        published = 0f
        lastPublish = Long.MIN_VALUE / 2
    }
}

class ScrollDirectionTracker(private val threshold: Double = 24.0) {
    var direction = ScrollDirection.Up
        private set
    private var anchor = 0.0

    fun offer(offset: Double, contentHeight: Double, viewportHeight: Double): ScrollDirection? {
        val maxOffset = max(0.0, contentHeight - viewportHeight)
        if (offset <= 0) {
            anchor = 0.0
            return update(ScrollDirection.Up)
        }
        if (offset >= maxOffset - 1 && maxOffset > 0) {
            anchor = offset
            return null
        }
        val delta = offset - anchor
        val turned = if (direction == ScrollDirection.Up) delta > threshold else delta < -threshold
        if (turned) {
            anchor = offset
            return update(if (delta > 0) ScrollDirection.Down else ScrollDirection.Up)
        }
        if (if (direction == ScrollDirection.Down) delta > 0 else delta < 0) anchor = offset
        return null
    }

    fun reset() {
        direction = ScrollDirection.Up
        anchor = 0.0
    }

    private fun update(next: ScrollDirection): ScrollDirection? {
        if (next == direction) return null
        direction = next
        return next
    }
}
