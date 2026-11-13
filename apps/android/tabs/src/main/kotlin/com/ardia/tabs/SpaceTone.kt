package com.ardia.tabs

import androidx.compose.ui.graphics.Color
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ColorMath
import com.ardia.design.ProfileLook
import com.ardia.design.ardiaColor
import com.ardia.design.parseHexColor
import com.ardia.sync.SyncedDevice
import com.ardia.sync.SyncedProfile
import androidx.compose.ui.graphics.vector.ImageVector

object SpaceTone {
    fun colors(profile: SyncedProfile?, dark: Boolean, increasedContrast: Boolean): List<Color> {
        val toward = if (dark) Color.Black else Color.White
        val amount = if (dark) (if (increasedContrast) 0.8f else 0.66f) else (if (increasedContrast) 0.9f else 0.8f)
        val theme = profile?.theme
        if (theme != null) {
            val source = if (dark) theme.darkColors ?: theme.colors else theme.colors
            val colors = source.mapNotNull(::parseHexColor)
            if (colors.isNotEmpty()) {
                val themeAmount = if (dark && theme.darkColors != null) (if (increasedContrast) 0.5f else 0.25f) else amount
                return colors.map { ColorMath.mixEncoded(it, toward, themeAmount) }
            }
        }
        val base = ProfileLook.of(profile?.color).swatchColor
        return listOf(
            ColorMath.mixEncoded(base, toward, amount),
            ColorMath.mixEncoded(base, toward, amount + if (dark) 0.06f else -0.04f),
        )
    }
}

object SpaceColors {
    private val named = mapOf(
        "red" to 0xFF3B30L,
        "orange" to 0xFF9500L,
        "yellow" to 0xFFCC00L,
        "green" to 0x34C759L,
        "mint" to 0x00C7BEL,
        "teal" to 0x30B0C7L,
        "cyan" to 0x32ADE6L,
        "blue" to 0x007AFFL,
        "indigo" to 0x5856D6L,
        "purple" to 0xAF52DEL,
        "violet" to 0xAF52DEL,
        "pink" to 0xFF2D55L,
        "brown" to 0xA2845EL,
        "gray" to 0x8E8E93L,
        "grey" to 0x8E8E93L,
    )

    fun hex(name: String?): Long? {
        val key = name?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        if (key.startsWith("#")) return key.drop(1).takeIf { it.length == 6 }?.toLongOrNull(16)
        return named[key]
    }

    fun color(name: String?): Color? = hex(name)?.let(::ardiaColor)

    fun symbol(name: String?): ImageVector? = name?.takeIf { it.isNotEmpty() }?.let(ArdiaSymbols::named)

    fun device(name: String, kind: String): ImageVector = when {
        kind == SyncedDevice.PHONE -> ArdiaSymbols.iphone
        name.contains("book", ignoreCase = true) -> ArdiaSymbols.laptopcomputer
        else -> ArdiaSymbols.named("desktopcomputer") ?: ArdiaSymbols.macbook
    }
}
