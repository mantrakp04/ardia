package com.ardia.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.sign

fun ardiaColor(hex: Long, alpha: Float = 1f): Color =
    Color(red = channel(hex, 16), green = channel(hex, 8), blue = channel(hex, 0), alpha = alpha)

private fun channel(hex: Long, shift: Int): Float = ((hex shr shift) and 0xFF).toFloat() / 255f

fun parseHexColor(text: String?): Color? {
    var value = text?.trim() ?: return null
    if (value.startsWith("#")) value = value.drop(1)
    if (value.length != 6) return null
    val number = value.toLongOrNull(16) ?: return null
    return ardiaColor(number)
}

@Immutable
data class AdaptiveColor(val light: Color, val dark: Color) {
    fun resolve(dark: Boolean): Color = if (dark) this.dark else light

    val current: Color
        @Composable @ReadOnlyComposable get() = resolve(LocalArdiaDarkTheme.current)
}

fun adaptive(light: Color, dark: Color): AdaptiveColor = AdaptiveColor(light, dark)

object ColorMath {
    fun linear(encoded: Double): Double {
        val magnitude = abs(encoded)
        val value = if (magnitude <= 0.04045) magnitude / 12.92 else ((magnitude + 0.055) / 1.055).pow(2.4)
        return value * sign(encoded).let { if (it == 0.0) 1.0 else it }
    }

    fun encoded(linear: Double): Double {
        val magnitude = abs(linear)
        val value = if (magnitude <= 0.0031308) magnitude * 12.92 else 1.055 * magnitude.pow(1 / 2.4) - 0.055
        return value * sign(linear).let { if (it == 0.0) 1.0 else it }
    }

    fun extendedSrgb(color: Color): DoubleArray {
        val converted = color.convert(ColorSpaces.ExtendedSrgb)
        return doubleArrayOf(converted.red.toDouble(), converted.green.toDouble(), converted.blue.toDouble(), converted.alpha.toDouble())
    }

    fun relativeLuminance(color: Color): Double {
        val rgb = extendedSrgb(color)
        return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
    }

    fun contrast(first: Color, second: Color): Double {
        val a = relativeLuminance(first)
        val b = relativeLuminance(second)
        return (maxOf(a, b) + 0.05) / (minOf(a, b) + 0.05)
    }

    fun mixEncoded(from: Color, to: Color, amount: Float): Color {
        val start = from.convert(ColorSpaces.Srgb)
        val end = to.convert(ColorSpaces.Srgb)
        return Color(
            red = start.red + (end.red - start.red) * amount,
            green = start.green + (end.green - start.green) * amount,
            blue = start.blue + (end.blue - start.blue) * amount,
            alpha = start.alpha + (end.alpha - start.alpha) * amount,
        )
    }
}

fun Color.ardiaGradient(): Brush = Brush.verticalGradient(
    listOf(ColorMath.mixEncoded(this, Color.White.copy(alpha = alpha), 0.1f), ColorMath.mixEncoded(this, Color.Black.copy(alpha = alpha), 0.05f)),
)

object LegibleInk {
    private val lightSurface = floatArrayOf(0.949f, 0.949f, 0.969f)
    private val darkSurface = floatArrayOf(0.110f, 0.110f, 0.118f)

    fun resolve(tint: Color, dark: Boolean, increasedContrast: Boolean = false): Color {
        val target = if (increasedContrast) 7f else 4.5f
        val surface = if (dark) darkSurface else lightSurface
        val destination = if (dark) 1f else 0f
        val start = tint.convert(ColorSpaces.ExtendedSrgb)
        val origin = floatArrayOf(start.red, start.green, start.blue)
        var candidate = origin
        var amount = 0f
        while (contrast(candidate, surface) < target && amount < 1f) {
            amount = minOf(1f, amount + 0.03f)
            candidate = FloatArray(3) { origin[it] + (destination - origin[it]) * amount }
        }
        return Color(candidate[0], candidate[1], candidate[2], start.alpha, ColorSpaces.ExtendedSrgb)
    }

    private fun luminance(rgb: FloatArray): Float =
        0.2126f * linear(rgb[0]) + 0.7152f * linear(rgb[1]) + 0.0722f * linear(rgb[2])

    private fun linear(value: Float): Float = ColorMath.linear(value.toDouble()).toFloat()

    private fun contrast(a: FloatArray, b: FloatArray): Float {
        val first = luminance(a)
        val second = luminance(b)
        return (maxOf(first, second) + 0.05f) / (minOf(first, second) + 0.05f)
    }
}

@Composable
@ReadOnlyComposable
fun legibleInk(tint: Color): Color = LegibleInk.resolve(tint, LocalArdiaDarkTheme.current, LocalIncreasedContrast.current)
