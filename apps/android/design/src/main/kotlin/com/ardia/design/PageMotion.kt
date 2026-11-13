package com.ardia.design

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class LoadProgress {
    enum class Phase { Idle, Waiting, Showing, Finishing, Fading }

    var phase: Phase = Phase.Idle
        private set
    var fraction: Double = 0.0
        private set
    var restartsAfterFade: Boolean = false
        private set

    val isVisible: Boolean get() = phase == Phase.Showing || phase == Phase.Finishing

    fun start() {
        when (phase) {
            Phase.Idle -> {
                phase = Phase.Waiting
                fraction = 0.0
            }
            Phase.Finishing, Phase.Fading -> restartsAfterFade = true
            Phase.Waiting, Phase.Showing -> Unit
        }
    }

    fun reveal(): Boolean {
        if (phase != Phase.Waiting) return false
        phase = Phase.Showing
        fraction = max(fraction, FLOOR)
        return true
    }

    fun advance(raw: Double) {
        if (phase != Phase.Waiting && phase != Phase.Showing) return
        if (!raw.isFinite() || raw <= 0) return
        val capped = min(raw, CEILING)
        fraction = max(fraction, if (phase == Phase.Showing) max(capped, FLOOR) else capped)
    }

    fun finish() {
        when (phase) {
            Phase.Waiting -> {
                phase = Phase.Idle
                fraction = 0.0
            }
            Phase.Showing -> {
                phase = Phase.Finishing
                fraction = 1.0
            }
            Phase.Finishing, Phase.Fading -> restartsAfterFade = false
            Phase.Idle -> Unit
        }
    }

    fun fade() {
        if (phase != Phase.Finishing) return
        phase = Phase.Fading
    }

    fun settle() {
        if (phase != Phase.Fading) return
        fraction = 0.0
        phase = if (restartsAfterFade) Phase.Waiting else Phase.Idle
        restartsAfterFade = false
    }

    companion object {
        const val FLOOR = 0.1
        const val CEILING = 0.94
    }
}

data class PagerCardPose(
    val x: Double = 0.0,
    val scale: Double = 1.0,
    val dim: Double = 0.0,
    val opacity: Double = 1.0,
    val shadow: Double = 0.0,
)

data class PagerDepthLayout(val outgoing: PagerCardPose, val incoming: PagerCardPose?, val incomingSide: Int)

object PagerPhysics {
    const val rubberLimit = 60.0
    const val parallax = 0.3
    const val recededScale = 0.92
    const val recededDim = 0.32
    const val edgeScale = 0.03
    const val projectionTime = 0.12
    const val commitFraction = 0.5
    const val opposingVelocity = 240.0

    fun rubberBand(distance: Double, limit: Double = rubberLimit): Double {
        val magnitude = abs(distance)
        val banded = limit * (1 - 1 / (magnitude / limit + 1))
        return if (distance < 0) -banded else banded
    }

    fun resolvedOffset(raw: Double, hasLeft: Boolean, hasRight: Boolean, width: Double): Double = when {
        raw > 0 -> if (hasLeft) min(raw, width) else rubberBand(raw)
        raw < 0 -> if (hasRight) max(raw, -width) else rubberBand(raw)
        else -> 0.0
    }

    fun snapTarget(offset: Double, velocity: Double, width: Double, hasLeft: Boolean, hasRight: Boolean): Int {
        if (width <= 0) return 0
        val projected = offset + velocity * projectionTime
        if (hasLeft && projected > width * commitFraction && velocity > -opposingVelocity) return 1
        if (hasRight && projected < -width * commitFraction && velocity < opposingVelocity) return -1
        return 0
    }

    fun layout(offset: Double, width: Double, hasLeft: Boolean, hasRight: Boolean, reduceMotion: Boolean): PagerDepthLayout {
        val side = if (offset > 0 && hasLeft) -1 else if (offset < 0 && hasRight) 1 else 0
        if (width <= 0) return PagerDepthLayout(PagerCardPose(), null, 0)
        if (side == 0) {
            val pull = min(abs(offset) / rubberLimit, 1.0)
            val x = if (reduceMotion) 0.0 else offset
            return PagerDepthLayout(PagerCardPose(x = x, scale = if (reduceMotion) 1.0 else 1 - edgeScale * pull), null, 0)
        }
        val progress = min(abs(offset) / width, 1.0)
        if (reduceMotion) {
            return PagerDepthLayout(PagerCardPose(), PagerCardPose(opacity = progress), side)
        }
        val outgoing = PagerCardPose(x = offset * parallax, scale = 1 - (1 - recededScale) * progress, dim = recededDim * progress)
        val incoming = PagerCardPose(x = side * width + offset, shadow = 1 - progress)
        return PagerDepthLayout(outgoing, incoming, side)
    }
}

object DeckHeaderMetrics {
    const val titleHidden = 52.0
    const val titleShown = 84.0
    const val iconFade = 12.0
    const val trailingFade = 14.0

    fun titleReveal(width: Double): Double = ((width - titleHidden) / (titleShown - titleHidden)).coerceIn(0.0, 1.0)

    fun iconReveal(width: Double, icon: Double): Double = ((width - icon) / iconFade).coerceIn(0.0, 1.0)

    fun contentLeading(available: Double, icon: Double, spacing: Double, title: Double, reveal: Double): Double {
        val content = icon + (spacing + title) * reveal
        return max(0.0, (available - content) / 2)
    }
}
