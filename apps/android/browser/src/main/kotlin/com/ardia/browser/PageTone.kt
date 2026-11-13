package com.ardia.browser

import kotlin.math.pow
import kotlin.math.roundToInt

data class PageTone(val top: Int? = null, val bottom: Int? = null) {
    companion object {
        fun resolve(themeColor: Int?, backgroundColor: Int?, sampled: PageTone?, stored: Int?): PageTone = PageTone(
            top = themeColor ?: sampled?.top ?: backgroundColor ?: stored,
            bottom = sampled?.bottom ?: backgroundColor ?: themeColor ?: stored,
        )
    }
}

object PageColors {
    private val rgb = Regex("rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+%?))?\\s*\\)")

    fun opaque(red: Int, green: Int, blue: Int): Int =
        (0xFF shl 24) or (red.coerceIn(0, 255) shl 16) or (green.coerceIn(0, 255) shl 8) or blue.coerceIn(0, 255)

    fun parseCss(value: String?): Int? {
        val match = rgb.matchEntire(value?.trim() ?: return null) ?: return null
        val (red, green, blue) = match.destructured.toList().take(3).map { it.toDouble().roundToInt() }
        val alphaText = match.groupValues[4]
        if (alphaText.isNotEmpty()) {
            val alpha = if (alphaText.endsWith("%")) alphaText.dropLast(1).toDouble() / 100 else alphaText.toDouble()
            if (alpha <= 0.5) return null
        }
        return opaque(red, green, blue)
    }

    fun parseHex(value: String?): Int? {
        val text = value?.trim()?.removePrefix("#") ?: return null
        if (text.length != 6) return null
        val packed = text.toIntOrNull(16) ?: return null
        return opaque((packed shr 16) and 0xFF, (packed shr 8) and 0xFF, packed and 0xFF)
    }

    fun hex(color: Int): String = "#%06X".format(color and 0xFFFFFF)

    fun luminance(color: Int): Double {
        fun linear(channel: Int): Double {
            val value = channel / 255.0
            return if (value <= 0.03928) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * linear((color shr 16) and 0xFF) + 0.7152 * linear((color shr 8) and 0xFF) + 0.0722 * linear(color and 0xFF)
    }

    fun isDark(color: Int): Boolean = luminance(color) < 0.18
}

object ToneSampler {
    const val SAMPLE_WIDTH = 32
    const val SAMPLE_HEIGHT = 2
    const val BAND_HEIGHT_DP = 4f

    fun dominant(pixels: IntArray): Int? {
        if (pixels.isEmpty()) return null
        val counts = HashMap<Int, IntArray>()
        for (pixel in pixels) {
            val red = (pixel shr 16) and 0xFF
            val green = (pixel shr 8) and 0xFF
            val blue = pixel and 0xFF
            val key = ((red shr 4) shl 8) or ((green shr 4) shl 4) or (blue shr 4)
            val bucket = counts.getOrPut(key) { IntArray(4) }
            bucket[0] += 1
            bucket[1] += red
            bucket[2] += green
            bucket[3] += blue
        }
        val best = counts.values.maxByOrNull { it[0] } ?: return null
        if (best[0] * 3 < pixels.size) return null
        val count = best[0].toDouble()
        return PageColors.opaque((best[1] / count).roundToInt(), (best[2] / count).roundToInt(), (best[3] / count).roundToInt())
    }
}

object CaptureCheck {
    private const val OPAQUE_BLACK = 0xFF000000.toInt()

    fun isBlank(pixels: IntArray, blackIsBlank: Boolean): Boolean {
        if (pixels.isEmpty()) return true
        if (pixels.all { (it ushr 24) == 0 }) return true
        return blackIsBlank && pixels.all { it == OPAQUE_BLACK }
    }

    fun isNearlyUniform(pixels: IntArray, share: Double = 0.99, tolerance: Int = 6): Boolean {
        if (pixels.isEmpty()) return true
        val counts = HashMap<Int, Int>()
        for (pixel in pixels) {
            val color = pixel and 0xFFFFFF
            counts[color] = (counts[color] ?: 0) + 1
        }
        val mode = counts.maxBy { it.value }.key
        val near = pixels.count { pixel ->
            kotlin.math.abs(((pixel shr 16) and 0xFF) - ((mode shr 16) and 0xFF)) <= tolerance &&
                kotlin.math.abs(((pixel shr 8) and 0xFF) - ((mode shr 8) and 0xFF)) <= tolerance &&
                kotlin.math.abs((pixel and 0xFF) - (mode and 0xFF)) <= tolerance
        }
        return near >= pixels.size * share
    }
}
