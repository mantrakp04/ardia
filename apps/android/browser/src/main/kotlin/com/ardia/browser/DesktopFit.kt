package com.ardia.browser

import java.util.Locale
import kotlin.math.abs

object DesktopFit {
    const val SMALLEST_FACTOR = 0.02
    const val LARGEST_FACTOR = 100.0
    private const val CLOSE_ENOUGH = 0.02

    const val CONTENT_WIDTH_SCRIPT = "Math.max(document.documentElement ? document.documentElement.scrollWidth : 0, document.body ? document.body.scrollWidth : 0)"

    const val MEASURE_SCRIPT = """(() => {
  const root = document.documentElement;
  const view = window.visualViewport;
  const tags = Array.from(document.getElementsByTagName("meta")).filter((meta) => (meta.getAttribute("name") || "").toLowerCase() === "viewport").map((meta) => meta.getAttribute("content") || "");
  return JSON.stringify({
    rootWidth: root ? root.scrollWidth : 0,
    bodyWidth: document.body ? document.body.scrollWidth : 0,
    innerWidth: window.innerWidth,
    viewportWidth: view ? view.width : null,
    viewportScale: view ? view.scale : null,
    tags: tags,
    trace: window.__ardiaDesktopTrace || null,
  });
})()"""

    sealed interface Decision {
        data class Zoom(val factor: Float) : Decision {
            override fun toString(): String = "zoomBy(${String.format(Locale.US, "%.4f", factor)})"
        }

        data class Skip(val reason: String) : Decision {
            override fun toString(): String = "skipped: $reason"
        }
    }

    fun decide(viewWidthPixels: Int, contentWidthCss: Double?, currentScale: Float): Decision {
        if (viewWidthPixels <= 0) return Decision.Skip("the view has no width")
        if (contentWidthCss == null || !contentWidthCss.isFinite() || contentWidthCss <= 0.0) return Decision.Skip("no content width")
        if (!currentScale.isFinite() || currentScale <= 0f) return Decision.Skip("no current scale")
        val factor = viewWidthPixels / contentWidthCss / currentScale
        if (!factor.isFinite() || factor <= 0.0) return Decision.Skip("the factor is not a number")
        val shown = String.format(Locale.US, "%.4f", factor)
        if (abs(factor - 1.0) < CLOSE_ENOUGH) return Decision.Skip("already fits (factor $shown)")
        if (factor >= 1.0) return Decision.Skip("the content is narrower than the view (factor $shown)")
        return Decision.Zoom(factor.coerceIn(SMALLEST_FACTOR, LARGEST_FACTOR).toFloat())
    }

    fun zoomFactor(viewWidthPixels: Int, contentWidthCss: Double, currentScale: Float): Float? =
        (decide(viewWidthPixels, contentWidthCss, currentScale) as? Decision.Zoom)?.factor

    fun contentWidth(evaluated: String?): Double? {
        val value = evaluated?.trim()?.toDoubleOrNull() ?: return null
        return value.takeIf { it.isFinite() && it > 0.0 }
    }
}
