package com.ardia.appmodel

import android.graphics.Bitmap
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.design.ArdiaSpring
import com.ardia.design.Motion
import com.ardia.store.BrowserTab
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt

@Stable
class PagerModel(private val settleSpring: ArdiaSpring = Motion.pagerSettle, private val clock: () -> Long = System::nanoTime) {
    data class Settle(val from: Float, val to: Float, val velocity: Float, val startNanos: Long)

    var isActive: Boolean by mutableStateOf(false)
    var offset: Float by mutableStateOf(0f)
    var current: BrowserTab? by mutableStateOf(null)
    var left: BrowserTab? by mutableStateOf(null)
    var right: BrowserTab? by mutableStateOf(null)
    val images = mutableStateMapOf<String, Bitmap>()

    var order: List<BrowserTab> = emptyList()
    var isTracking = false
    var trackingBase = 0f
    var activationTranslation = 0f
    var settle: Settle? = null
    var generation = 0
        private set

    val hasLeft: Boolean get() = left != null
    val hasRight: Boolean get() = right != null

    fun begin(order: List<BrowserTab>, currentId: String?): Boolean {
        val index = order.indexOfFirst { it.id == currentId }
        if (index < 0) return false
        this.order = order
        current = order[index]
        left = order.getOrNull(index - 1)
        right = order.getOrNull(index + 1)
        isActive = true
        return true
    }

    fun startSettle(to: Float, velocity: Float) {
        generation += 1
        settle = Settle(offset, to, velocity, clock())
        offset = to
    }

    fun presentedOffset(atNanos: Long = clock()): Float {
        val settle = settle ?: return offset
        val delta = settle.to - settle.from
        if (abs(delta) <= 0.5f) return settle.to
        val elapsed = maxOf(0L, atNanos - settle.startNanos) / 1_000_000_000.0
        return settle.from + springValue(settleSpring, delta.toDouble(), settle.velocity.toDouble(), elapsed).toFloat()
    }

    fun isSettled(atNanos: Long = clock()): Boolean {
        val settle = settle ?: return true
        return abs(presentedOffset(atNanos) - settle.to) < 0.5f && atNanos - settle.startNanos > (settleSpring.response * 1e9).toLong()
    }

    fun catchSettle() {
        if (settle == null) return
        val caught = presentedOffset()
        settle = null
        generation += 1
        offset = caught
    }

    fun reset() {
        generation += 1
        settle = null
        isTracking = false
        order = emptyList()
        current = null
        left = null
        right = null
        offset = 0f
        isActive = false
    }

    companion object {
        fun springValue(spring: ArdiaSpring, target: Double, initialVelocity: Double, time: Double): Double {
            val omega = 2 * PI / spring.response
            val zeta = spring.dampingFraction.toDouble().coerceAtMost(1.0)
            val initial = target
            val remaining = if (zeta >= 1.0) {
                val slope = -initialVelocity + omega * initial
                (initial + slope * time) * exp(-omega * time)
            } else {
                val damped = omega * sqrt(1 - zeta * zeta)
                val slope = (-initialVelocity + zeta * omega * initial) / damped
                exp(-zeta * omega * time) * (initial * cos(damped * time) + slope * sin(damped * time))
            }
            return target - remaining
        }
    }
}
