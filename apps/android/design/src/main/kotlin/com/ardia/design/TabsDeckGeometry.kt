package com.ardia.design

import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong

data class DeckSize(val width: Double, val height: Double)

data class DeckPoint(val x: Double, val y: Double)

data class TabsDeckGeometry(val container: DeckSize, val safeTop: Double, val safeBottom: Double, val safeSide: Double = 0.0) {
    val cardSize: DeckSize
    val focusLeading: Double
    val spacing: Double
    val leftReach: Double
    val cardCenterY: Double

    init {
        val width = max(container.width, 1.0)
        val height = max(container.height, 1.0)
        val bandTop = safeTop + TOP_RESERVE + HEADER_HEIGHT
        val bandBottom = height - max(safeBottom, 20.0) - BAR_RESERVE + 24
        val band = max(bandBottom - bandTop, 120.0)
        val aspect = height / width
        val cardWidth = min(width * CARD_WIDTH_RATIO, band / aspect)
        cardSize = DeckSize(cardWidth, cardWidth * aspect)
        focusLeading = width * FOCUS_LEADING_RATIO
        spacing = min(cardWidth, width * STEP_RATIO)
        leftReach = reach(min(LEFT_PEEK, focusLeading - 6), spacing)
        cardCenterY = bandTop + band / 2
    }

    fun leading(relative: Double): Double {
        if (relative >= 0) return focusLeading + spacing * relative
        return focusLeading - leftReach * (1 - exp(relative * spacing / leftReach))
    }

    fun center(relative: Double): DeckPoint = DeckPoint(leading(relative) + cardSize.width / 2, cardCenterY)

    fun scale(relative: Double): Double = 1.0

    fun visibleWidth(relative: Double, isLast: Boolean): Double {
        if (isLast) return cardSize.width
        return min(cardSize.width, max(0.0, leading(relative + 1) - leading(relative)))
    }

    val expandedScale: Double get() = container.width / max(cardSize.width, 1.0)

    val expandedCenter: DeckPoint get() = DeckPoint(container.width / 2, container.height / 2)

    val tabButtonCenter: DeckPoint get() = DeckPoint(safeSide + 16 + 17.5, barCenterY)

    val barCenterY: Double get() = container.height - max(safeBottom, 20.0) - 6

    fun scrollDelta(dragTranslation: Double): Double = -dragTranslation / spacing

    fun settleTarget(scroll: Double, velocity: Double, count: Int): Int {
        if (count <= 0) return 0
        val projected = scroll - (velocity / spacing) * 0.22
        return projected.swiftRounded().coerceIn(0, count - 1)
    }

    companion object {
        const val CARD_WIDTH_RATIO = 306.0 / 440.0
        const val FOCUS_LEADING_RATIO = 66.0 / 440.0
        const val LEFT_PEEK = 70.0
        const val STEP_RATIO = 218.0 / 440.0
        const val HEADER_HEIGHT = 20.0
        const val BAR_RESERVE = 58.0
        const val TOP_RESERVE = 12.0
        const val HEADER_FAVICON_ONLY_WIDTH = 72.0

        internal fun reach(peek: Double, spacing: Double): Double {
            val clamped = max(peek, 8.0)
            var reach = clamped
            repeat(6) { reach = clamped / (1 - exp(-spacing / reach)) }
            return reach
        }

        fun rubberBand(scroll: Double, count: Int): Double {
            val upper = max(count - 1, 0).toDouble()
            if (scroll < 0) return -(-scroll).pow(0.7) * 0.35
            if (scroll > upper) return upper + (scroll - upper).pow(0.7) * 0.35
            return scroll
        }

        fun renderedRange(scroll: Double, count: Int): IntRange {
            if (count <= 0) return IntRange.EMPTY
            val anchor = scroll.swiftRounded()
            val lower = max(0, anchor - 6)
            val upper = min(count, anchor + 6)
            return if (lower < upper) lower until upper else IntRange.EMPTY
        }

        fun scrollAfterRemoving(removed: Int, scroll: Int, remaining: Int): Int {
            if (remaining <= 0) return 0
            val shifted = if (removed < scroll) scroll - 1 else scroll
            return shifted.coerceIn(0, remaining - 1)
        }

        fun shouldClose(translation: Double, velocity: Double, cardHeight: Double): Boolean {
            if (translation >= 0) return false
            if (velocity < -500) return true
            return -translation > cardHeight / 3 && velocity < 250
        }
    }
}

internal fun Double.swiftRounded(): Int {
    val magnitude = kotlin.math.abs(this)
    val rounded = (magnitude + 0.5).let { kotlin.math.floor(it) }
    return (if (this < 0) -rounded else rounded).roundToLong().toInt()
}
