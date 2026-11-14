package com.ardia.tabs

import com.ardia.design.TabsDeckGeometry
import kotlin.math.max
import kotlin.math.min

enum class DeckRole { Stay, Expanded, Launcher, SlideLeft, SlideRight }

sealed interface DeckPhase {
    data class Opening(val expanded: String?) : DeckPhase

    data object Settled : DeckPhase

    data class Closing(val expanded: String) : DeckPhase
}

class DeckPose {
    var centerX = 0.0
    var centerY = 0.0
    var scale = 1.0
    var corner = CARD_RADIUS
    var opacity = 1.0
    var headerOpacity = 1.0
    var visibleWidth = 0.0

    fun resolve(
        geometry: TabsDeckGeometry,
        role: DeckRole,
        relative: Double,
        scaleProgress: Double,
        positionProgress: Double,
        lift: Double,
        vanish: Double,
        isLast: Boolean,
    ): DeckPose {
        val deckCenter = geometry.center(relative)
        val deckScale = geometry.scale(relative)
        var x = deckCenter.x
        var y = deckCenter.y
        var size = deckScale
        var radius = CARD_RADIUS
        var alpha = 1.0
        when (role) {
            DeckRole.Stay -> Unit
            DeckRole.Expanded -> {
                val expanded = geometry.expandedCenter
                size = lerp(geometry.expandedScale, deckScale, scaleProgress)
                x = lerp(expanded.x, deckCenter.x, positionProgress)
                y = lerp(expanded.y, deckCenter.y, positionProgress)
                radius = lerp(DISPLAY_CORNER_RADIUS, CARD_RADIUS, scaleProgress)
            }
            DeckRole.Launcher -> {
                val start = LAUNCHER_START_WIDTH / max(geometry.cardSize.width, 1.0)
                val button = geometry.tabButtonCenter
                size = lerp(start, deckScale, scaleProgress)
                x = lerp(button.x, deckCenter.x, positionProgress)
                y = lerp(button.y, deckCenter.y, positionProgress)
                radius = lerp(LAUNCHER_START_RADIUS, CARD_RADIUS, scaleProgress)
                alpha = min(1.0, scaleProgress * 2.5)
            }
            DeckRole.SlideLeft -> x -= (1 - positionProgress) * geometry.container.width * 0.7
            DeckRole.SlideRight -> x += (1 - positionProgress) * geometry.container.width
        }
        val clampedVanish = vanish.coerceIn(0.0, 1.0)
        y += lift
        size *= 1 - 0.28 * clampedVanish
        alpha *= 1 - clampedVanish
        val settle = if (role == DeckRole.Stay) 1.0 else max(0.0, (positionProgress - 0.7) / 0.3)
        val liftFade = max(0.0, 1 + lift / 120)
        centerX = x
        centerY = y
        scale = size
        corner = radius
        opacity = alpha
        headerOpacity = min(1.0, settle) * min(1.0, liftFade) * (1 - clampedVanish)
        visibleWidth = geometry.visibleWidth(relative, isLast)
        return this
    }

    companion object {
        const val CARD_RADIUS = 13.0
        const val DISPLAY_CORNER_RADIUS = 55.0
        const val LAUNCHER_START_WIDTH = 22.0
        const val LAUNCHER_START_RADIUS = 4.0

        fun lerp(from: Double, to: Double, t: Double): Double = from + (to - from) * t

        fun role(phase: DeckPhase, id: String, index: Int, order: List<String>): DeckRole = when (phase) {
            DeckPhase.Settled -> DeckRole.Stay
            is DeckPhase.Opening -> {
                val expanded = phase.expanded
                val expandedIndex = if (expanded == null) -1 else order.indexOf(expanded)
                when {
                    expandedIndex < 0 -> DeckRole.Stay
                    id == expanded -> DeckRole.Expanded
                    index < expandedIndex -> DeckRole.Launcher
                    else -> DeckRole.SlideRight
                }
            }
            is DeckPhase.Closing -> {
                val expandedIndex = order.indexOf(phase.expanded)
                when {
                    expandedIndex < 0 -> DeckRole.Stay
                    id == phase.expanded -> DeckRole.Expanded
                    index < expandedIndex -> DeckRole.SlideLeft
                    else -> DeckRole.SlideRight
                }
            }
        }

        fun backdropOpacity(phase: DeckPhase, positionProgress: Double): Double = when (phase) {
            is DeckPhase.Opening -> if (phase.expanded != null) min(1.0, positionProgress * 1.4) else 1.0
            is DeckPhase.Closing -> min(1.0, positionProgress * 1.4)
            DeckPhase.Settled -> 1.0
        }

        fun chromeOpacity(phase: DeckPhase, positionProgress: Double): Double = when (phase) {
            DeckPhase.Settled -> 1.0
            is DeckPhase.Opening -> if (phase.expanded == null) 1.0 else max(0.0, (positionProgress - 0.6) / 0.4)
            is DeckPhase.Closing -> max(0.0, (positionProgress - 0.6) / 0.4)
        }
    }
}

object DeckHit {
    fun cardAt(
        geometry: TabsDeckGeometry,
        count: Int,
        range: IntRange,
        x: Double,
        y: Double,
        relativeOf: (Int) -> Double,
    ): Int? {
        if (count <= 0) return null
        val halfHeight = geometry.cardSize.height / 2
        if (y < geometry.cardCenterY - halfHeight || y > geometry.cardCenterY + halfHeight) return null
        for (index in range.last downTo range.first) {
            if (index !in 0 until count) continue
            val leading = geometry.leading(relativeOf(index))
            if (x >= leading && x <= leading + geometry.cardSize.width) return index
        }
        return null
    }
}
