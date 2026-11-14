package com.ardia.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Immutable
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sqrt

object SwiftEasing {
    val easeOut: Easing = CubicBezierEasing(0f, 0f, 0.58f, 1f)
    val easeIn: Easing = CubicBezierEasing(0.42f, 0f, 1f, 1f)
    val easeInOut: Easing = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
    val linear: Easing = LinearEasing
    val logoSpin: Easing = CubicBezierEasing(0.12f, 0.7f, 0.25f, 1f)
}

@Immutable
sealed interface ArdiaMotion {
    fun <T> spec(visibilityThreshold: T? = null): FiniteAnimationSpec<T>
}

@Immutable
data class ArdiaSpring(val response: Float, val dampingFraction: Float) : ArdiaMotion {
    val stiffness: Float get() = (2.0 * PI / response).pow(2).toFloat()

    val dampingRatio: Float get() = dampingFraction

    val damping: Float get() = (2.0 * dampingFraction * sqrt(stiffness.toDouble())).toFloat()

    override fun <T> spec(visibilityThreshold: T?): FiniteAnimationSpec<T> =
        spring(dampingRatio = dampingRatio, stiffness = stiffness, visibilityThreshold = visibilityThreshold)

    companion object {
        fun withBounce(duration: Float, bounce: Float): ArdiaSpring =
            ArdiaSpring(response = duration, dampingFraction = if (bounce >= 0f) 1f - bounce else 1f / (1f + bounce))
    }
}

@Immutable
data class ArdiaTween(val durationMillis: Int, val easing: Easing, val delayMillis: Int = 0) : ArdiaMotion {
    override fun <T> spec(visibilityThreshold: T?): FiniteAnimationSpec<T> =
        tween(durationMillis = durationMillis, delayMillis = delayMillis, easing = easing)
}

object Motion {
    val snappy = ArdiaSpring(response = 0.3f, dampingFraction = 0.86f)
    val smooth = ArdiaSpring(response = 0.42f, dampingFraction = 0.9f)
    val tabStack = ArdiaSpring.withBounce(duration = 0.4f, bounce = 0.2f)
    val modeToggle = ArdiaSpring.withBounce(duration = 0.3f, bounce = 0.15f)

    val searchRise = ArdiaSpring(response = 0.39f, dampingFraction = 1f)
    val surfaceSwap = ArdiaTween(300, SwiftEasing.easeOut)
    val surfaceFade = ArdiaTween(200, SwiftEasing.easeOut)
    val trayDim = ArdiaTween(300, SwiftEasing.easeInOut)
    val trayDismiss = ArdiaSpring(response = 0.32f, dampingFraction = 1f)
    val traySettle = ArdiaSpring(response = 0.34f, dampingFraction = 0.86f)
    val resultsIn = ArdiaTween(140, SwiftEasing.easeOut)
    val pager = ArdiaSpring(response = 0.3f, dampingFraction = 0.9f)
    val press = ArdiaSpring(response = 0.2f, dampingFraction = 0.7f)
    val barPressIn = ArdiaSpring.withBounce(duration = 0.08f, bounce = 0f)
    val barPressOut = ArdiaSpring.withBounce(duration = 0.16f, bounce = 0.1f)
    val barCollapse = ArdiaSpring.withBounce(duration = 0.4f, bounce = 0f)
    val progressReveal = ArdiaTween(200, SwiftEasing.easeOut)
    val progressAdvance = ArdiaTween(450, SwiftEasing.easeOut)
    val progressFill = ArdiaTween(200, SwiftEasing.easeOut)
    val progressFade = ArdiaTween(250, SwiftEasing.easeOut)
    const val progressRevealDelayMillis = 150L
    const val placeholderDelayMillis = 300L
    val placeholderIn = ArdiaTween(220, SwiftEasing.easeOut)
    val pagerSettle = ArdiaSpring.withBounce(duration = 0.38f, bounce = 0f)
    val pagerFade = ArdiaTween(200, SwiftEasing.easeOut)
    val barTone = ArdiaTween(250, SwiftEasing.easeOut)
    val logoSpin = ArdiaTween(2200, SwiftEasing.logoSpin)
    val reducedFade = ArdiaTween(200, SwiftEasing.easeInOut)
    val reducedSettle = ArdiaTween(200, SwiftEasing.easeOut)
    val logoReset = ArdiaTween(300, SwiftEasing.easeOut)
}
