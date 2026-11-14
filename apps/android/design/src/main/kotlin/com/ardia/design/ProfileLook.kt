package com.ardia.design

import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

data class LookHsl(val hue: Double, val saturation: Double, val lightness: Double)

@Immutable
data class LookRgb(val red: Double, val green: Double, val blue: Double) {
    val hsl: LookHsl
        get() {
            val high = max(red, max(green, blue))
            val low = min(red, min(green, blue))
            val lightness = (high + low) / 2
            val spread = high - low
            if (spread <= 0) return LookHsl(0.0, 0.0, lightness)
            val saturation = if (lightness > 0.5) spread / (2 - high - low) else spread / (high + low)
            val sector = when (high) {
                red -> (green - blue) / spread + if (green < blue) 6 else 0
                green -> (blue - red) / spread + 2
                else -> (red - green) / spread + 4
            }
            return LookHsl(sector / 6, saturation, lightness)
        }

    val hex: Long
        get() = (byte(red) shl 16) or (byte(green) shl 8) or byte(blue)

    val hexString: String get() = "#" + hex.toString(16).uppercase().padStart(6, '0')

    val color: Color get() = ardiaColor(hex)

    val snapped: LookRgb get() = fromHex(hex)

    val luminance: Double
        get() {
            fun linear(value: Double) = if (value <= 0.03928) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
            return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
        }

    val greyed: LookRgb get() = hsl.lightness.let { LookRgb(it, it, it) }

    fun mixed(other: LookRgb, amount: Double): LookRgb = LookRgb(
        red + (other.red - red) * amount,
        green + (other.green - green) * amount,
        blue + (other.blue - blue) * amount,
    )

    fun lightened(delta: Double): LookRgb {
        val own = hsl
        return fromHsl(own.hue, own.saturation, (own.lightness + delta).coerceIn(0.0, 1.0))
    }

    fun toned(hueShift: Double = 0.0, saturation: Double, lightness: Double): LookRgb {
        val own = hsl
        var hue = own.hue + hueShift
        if (hue < 0) hue += 1
        if (hue > 1) hue -= 1
        return fromHsl(hue, if (own.saturation == 0.0) 0.0 else saturation, lightness)
    }

    fun contrast(other: LookRgb): Double {
        val lighter = max(luminance, other.luminance)
        val darker = min(luminance, other.luminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    companion object {
        val white = LookRgb(1.0, 1.0, 1.0)
        val black = LookRgb(0.0, 0.0, 0.0)

        private fun byte(value: Double): Long = floor(value.coerceIn(0.0, 1.0) * 255 + 0.5).toLong()

        fun fromHex(hex: Long): LookRgb = LookRgb(((hex shr 16) and 0xFF) / 255.0, ((hex shr 8) and 0xFF) / 255.0, (hex and 0xFF) / 255.0)

        fun parse(text: String?): LookRgb? {
            var value = text?.trim() ?: return null
            if (value.startsWith("#")) value = value.drop(1)
            if (value.length != 6) return null
            return value.toLongOrNull(16)?.let(::fromHex)
        }

        fun fromHsl(hue: Double, saturation: Double, lightness: Double): LookRgb {
            if (saturation <= 0) return LookRgb(lightness, lightness, lightness)
            val upper = if (lightness < 0.5) lightness * (1 + saturation) else lightness + saturation - lightness * saturation
            val lower = 2 * lightness - upper
            fun channel(offset: Double): Double {
                var turn = hue + offset
                if (turn < 0) turn += 1
                if (turn > 1) turn -= 1
                if (turn < 1.0 / 6) return lower + (upper - lower) * 6 * turn
                if (turn < 1.0 / 2) return upper
                if (turn < 2.0 / 3) return lower + (upper - lower) * (2.0 / 3 - turn) * 6
                return lower
            }
            return LookRgb(channel(1.0 / 3), channel(0.0), channel(-1.0 / 3))
        }
    }
}

@Immutable
class ProfileLook internal constructor(
    internal val swatch: LookRgb,
    internal val tint: LookRgb,
    internal val action: LookRgb,
    val isNeutral: Boolean,
    internal val theme: List<LookRgb>,
    internal val darkTheme: List<LookRgb>?,
    val isAlwaysDark: Boolean = false,
) {
    enum class Preset(val key: String, internal val swatch: Long, @param:StringRes val title: Int) {
        Plum("plum", 0xC07A98, R.string.ardia_color_plum),
        Blue("blue", 0x4691C3, R.string.ardia_color_blue),
        Purple("purple", 0x7873AF, R.string.ardia_color_purple),
        Pink("pink", 0xD37B8B, R.string.ardia_color_pink),
        Red("red", 0xC1575C, R.string.ardia_color_red),
        Orange("orange", 0xD87249, R.string.ardia_color_orange),
        Yellow("yellow", 0xE3AC38, R.string.ardia_color_yellow),
        Green("green", 0x3EB489, R.string.ardia_color_green),
        Neutral("neutral", 0x8E8E93, R.string.ardia_color_neutral),
        ;

        internal val tint: Long? get() = if (this == Plum) 0xB25B6B else null
        internal val action: Long? get() = if (this == Plum) 0xDD899B else null

        companion object {
            fun fromKey(key: String?): Preset? = key?.lowercase()?.let { wanted -> entries.firstOrNull { it.key == wanted } }
        }
    }

    internal object WindowTint {
        const val ALPHA = 0.36
        const val NEUTRAL_ALPHA = 0.12
        const val LIGHTNESS = 0.25
        const val HUE_SATURATION = 0.36
        const val HUE_LIGHTNESS = 0.527
        const val LIGHT_SHARE = 0.75
        const val DARK_SHARE = 0.5
        val inactiveLight = LookRgb(235 / 255.0, 231 / 255.0, 230 / 255.0)
        val inactiveDark = LookRgb(40.7 / 255, 33.1 / 255, 31.8 / 255)
        const val INCOGNITO = 0x3A3A3CL
    }

    val preset: Preset? get() = Preset.entries.firstOrNull { of(it) == this }

    val swatchColor: Color get() = swatch.color

    val surface: AdaptiveColor get() = surface(0)

    val surfaceLow: AdaptiveColor get() = surface(1)

    private fun surface(index: Int) = AdaptiveColor(
        backdropStops(dark = false, themed = false)[index].color,
        backdropStops(dark = true, themed = false)[index].color,
    )

    internal fun themeStops(dark: Boolean): List<LookRgb> = if (dark) darkTheme ?: theme else theme

    internal fun windowTintStops(dark: Boolean): List<LookRgb> {
        val alpha = (if (isNeutral) WindowTint.NEUTRAL_ALPHA else WindowTint.ALPHA) * if (dark) WindowTint.DARK_SHARE else WindowTint.LIGHT_SHARE
        val under = if (dark) {
            WindowTint.inactiveDark.mixed(LookRgb.black, 0.4)
        } else {
            LookRgb.white.mixed(WindowTint.inactiveLight, 0.2)
        }
        return listOf(tint, tint.lightened(WindowTint.LIGHTNESS)).map { under.mixed(it, alpha).snapped }
    }

    fun showsTheme(dark: Boolean, themed: Boolean): Boolean = themed && themeStops(dark).size >= 2

    internal fun backdropStops(dark: Boolean, themed: Boolean): List<LookRgb> =
        if (showsTheme(dark, themed)) themeStops(dark) else windowTintStops(dark || isAlwaysDark)

    fun inkIsLight(dark: Boolean, themed: Boolean): Boolean {
        val stops = backdropStops(dark, themed)
        val onWhite = stops.minOfOrNull { it.contrast(LookRgb.white) } ?: 1.0
        val onBlack = stops.minOfOrNull { it.contrast(LookRgb.black) } ?: 1.0
        return onWhite >= onBlack
    }

    internal fun deckBaseStops(dark: Boolean): List<LookRgb> {
        val window = windowTintStops(dark)
        val base = listOf(0.0, 0.5, 1.0, 0.9, 0.35, 0.65).map { window[0].mixed(window[1], it) }
        val stops = themeStops(dark)
        if (stops.size < 2) return base
        val share = if (dark) 0.18 else 0.1
        return base.mapIndexed { index, stop -> stop.mixed(stops[index % stops.size], share) }
    }

    internal fun deckBlobStops(dark: Boolean): List<LookRgb> {
        val base = if (isNeutral) swatch.greyed else swatch
        val blobs = if (dark) {
            listOf(base.toned(saturation = 0.38, lightness = 0.32), base.toned(0.05, 0.32, 0.27), base.toned(-0.06, 0.42, 0.26))
        } else {
            listOf(base.toned(saturation = 0.66, lightness = 0.86), base.toned(0.05, 0.84, 0.9), base.toned(-0.06, 0.7, 0.88))
        }
        val stops = themeStops(dark)
        if (stops.isEmpty()) return blobs
        return blobs.mapIndexed { index, blob -> blob.mixed(stops[index % stops.size], 0.2) }
    }

    fun windowTint(dark: Boolean): List<Color> = windowTintStops(dark).map { it.color }

    fun backdropColors(dark: Boolean, themed: Boolean): List<Color> = backdropStops(dark, themed).map { it.color }

    fun deckBase(dark: Boolean): List<Color> = deckBaseStops(dark).map { it.color }

    fun deckBlobs(dark: Boolean): List<Color> = deckBlobStops(dark).map { it.color }

    override fun equals(other: Any?): Boolean = other is ProfileLook &&
        swatch == other.swatch && tint == other.tint && action == other.action && isNeutral == other.isNeutral &&
        theme == other.theme && darkTheme == other.darkTheme && isAlwaysDark == other.isAlwaysDark

    override fun hashCode(): Int = listOf(swatch, tint, action, isNeutral, theme, darkTheme, isAlwaysDark).hashCode()

    override fun toString(): String = "ProfileLook(${preset?.key ?: swatch.hexString})"

    companion object {
        val plum: ProfileLook = of(Preset.Plum)

        val incognito: ProfileLook = LookRgb.fromHex(WindowTint.INCOGNITO).let {
            ProfileLook(it, it, it, isNeutral = true, theme = emptyList(), darkTheme = null, isAlwaysDark = true)
        }

        fun of(preset: Preset): ProfileLook {
            val swatch = LookRgb.fromHex(preset.swatch)
            val isNeutral = preset == Preset.Neutral
            return ProfileLook(
                swatch = swatch,
                tint = preset.tint?.let(LookRgb::fromHex) ?: tintForHueOf(swatch, isNeutral),
                action = preset.action?.let(LookRgb::fromHex) ?: swatch.lightened(0.12),
                isNeutral = isNeutral,
                theme = emptyList(),
                darkTheme = null,
            )
        }

        fun of(colorName: String?, themeColors: List<String> = emptyList(), darkThemeColors: List<String>? = null): ProfileLook {
            val theme = themeColors.mapNotNull(LookRgb::parse)
            val darkTheme = darkThemeColors?.mapNotNull(LookRgb::parse)?.ifEmpty { null }
            val first = theme.firstOrNull() ?: LookRgb.parse(colorName) ?: return of(Preset.fromKey(colorName) ?: Preset.Plum)
            val middle = theme.drop(1).fold(first) { mix, next -> mix.mixed(next, 0.5) }
            val isNeutral = middle.hsl.saturation < 0.12
            return ProfileLook(
                swatch = middle,
                tint = tintForHueOf(middle, isNeutral),
                action = middle.lightened(0.12),
                isNeutral = isNeutral,
                theme = theme,
                darkTheme = darkTheme,
            )
        }

        fun forApp(
            colorChoice: String?,
            syncEnabled: Boolean,
            profileColor: String? = null,
            profileThemeColors: List<String> = emptyList(),
            profileDarkThemeColors: List<String>? = null,
        ): ProfileLook {
            Preset.fromKey(colorChoice)?.let { return of(it) }
            return if (syncEnabled) of(profileColor, profileThemeColors, profileDarkThemeColors) else plum
        }

        internal fun tintForHueOf(swatch: LookRgb, grey: Boolean): LookRgb =
            LookRgb.fromHsl(swatch.hsl.hue, if (grey) 0.0 else WindowTint.HUE_SATURATION, WindowTint.HUE_LIGHTNESS).snapped
    }
}

val LocalProfileLook = staticCompositionLocalOf { ProfileLook.plum }
