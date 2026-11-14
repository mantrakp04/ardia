package com.ardia.browser

import kotlin.math.abs

object DesktopFit {
    const val SMALLEST_FACTOR = 0.02
    const val LARGEST_FACTOR = 100.0
    private const val CLOSE_ENOUGH = 0.02

    const val CONTENT_WIDTH_SCRIPT = "Math.max(document.documentElement ? document.documentElement.scrollWidth : 0, document.body ? document.body.scrollWidth : 0)"

    fun zoomFactor(viewWidthPixels: Int, contentWidthCss: Double, currentScale: Float): Float? {
        if (viewWidthPixels <= 0) return null
        if (!contentWidthCss.isFinite() || contentWidthCss <= 0.0) return null
        if (!currentScale.isFinite() || currentScale <= 0f) return null
        val fitted = viewWidthPixels / contentWidthCss
        val factor = fitted / currentScale
        if (!factor.isFinite() || factor <= 0.0) return null
        if (abs(factor - 1.0) < CLOSE_ENOUGH) return null
        if (factor >= 1.0) return null
        return factor.coerceIn(SMALLEST_FACTOR, LARGEST_FACTOR).toFloat()
    }

    fun contentWidth(evaluated: String?): Double? {
        val value = evaluated?.trim()?.toDoubleOrNull() ?: return null
        return value.takeIf { it.isFinite() && it > 0.0 }
    }
}
