package com.ardia.tabs

import com.ardia.design.ColorMath
import com.ardia.design.parseHexColor
import com.ardia.sync.SyncedProfile
import com.ardia.sync.SyncedTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpaceToneTest {
    private fun profile(color: String? = "green", theme: SyncedTheme? = null) =
        SyncedProfile(syncId = "p", name = "Work", color = color, isDefault = true, theme = theme)

    @Test
    fun namedAndHexGroupColorsResolveLikeTheMac() {
        assertEquals(0x007AFFL, SpaceColors.hex("Blue"))
        assertEquals(0xAF52DEL, SpaceColors.hex("violet"))
        assertEquals(0x123456L, SpaceColors.hex("#123456"))
        assertNull(SpaceColors.hex("chartreuse"))
        assertNull(SpaceColors.hex(""))
        assertNull(SpaceColors.hex(null))
    }

    @Test
    fun aThemedSpaceUsesItsDarkColorsLightlySoftenedAtNight() {
        val theme = SyncedTheme(listOf("#4F7CFF", "#9B6BFF"), listOf("#1E2A5A", "#3A2466"))
        val tones = SpaceTone.colors(profile(theme = theme), dark = true, increasedContrast = false)
        val expected = ColorMath.mixEncoded(parseHexColor("#1E2A5A")!!, androidx.compose.ui.graphics.Color.Black, 0.25f)
        assertEquals(2, tones.size)
        assertEquals(expected, tones.first())
    }

    @Test
    fun anUnthemedSpaceGetsTwoTonesOfItsSwatch() {
        val light = SpaceTone.colors(profile(), dark = false, increasedContrast = false)
        val strong = SpaceTone.colors(profile(), dark = false, increasedContrast = true)
        assertEquals(2, light.size)
        assertEquals(true, light[0] != light[1])
        assertEquals(true, ColorMath.relativeLuminance(strong[0]) > ColorMath.relativeLuminance(light[0]))
    }
}
