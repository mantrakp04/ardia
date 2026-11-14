package com.ardia.browser.android.system

import androidx.compose.ui.graphics.Color
import com.ardia.design.ProfileLook

data class WidgetColors(val backdrop: List<Color>, val ink: Color, val capsule: Color, val label: Color, val secondaryLabel: Color, val accent: Color, val monogramFill: Color) {
    companion object {
        const val CAPSULE_SHARE = 0.08f
        val INK_ON_LIGHT = Color(0xE60E0F10)

        fun of(look: ProfileLook, dark: Boolean, themed: Boolean): WidgetColors {
            val backdrop = look.backdropColors(dark, themed)
            val ink = if (look.inkIsLight(dark, themed)) Color.White else INK_ON_LIGHT
            val under = backdrop.lastOrNull() ?: if (dark) Color.Black else Color.White
            return WidgetColors(
                backdrop = backdrop,
                ink = ink,
                capsule = blend(under, ink, CAPSULE_SHARE),
                label = if (dark) Color.White else Color.Black,
                secondaryLabel = if (dark) Color(0x99EBEBF5) else Color(0x993C3C43),
                accent = if (dark) Color(0xFF0A84FF) else Color(0xFF007AFF),
                monogramFill = if (dark) Color(0x29787880) else Color(0x14787880),
            )
        }

        private fun blend(under: Color, over: Color, share: Float): Color = Color(
            red = under.red + (over.red - under.red) * share,
            green = under.green + (over.green - under.green) * share,
            blue = under.blue + (over.blue - under.blue) * share,
        )
    }
}
