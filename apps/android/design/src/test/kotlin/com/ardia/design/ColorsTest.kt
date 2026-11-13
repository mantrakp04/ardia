package com.ardia.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ColorsTest {
    private fun assertRgb(expected: DoubleArray, color: Color, tolerance: Double = 0.002) {
        val rgb = color.convert(ColorSpaces.ExtendedSrgb)
        assertEquals("red", expected[0], rgb.red.toDouble(), tolerance)
        assertEquals("green", expected[1], rgb.green.toDouble(), tolerance)
        assertEquals("blue", expected[2], rgb.blue.toDouble(), tolerance)
    }

    @Test
    fun `hex colours parse like the iPhone's`() {
        assertEquals(Color(0xFF3F48F2), parseHexColor(" #3F48F2 "))
        assertEquals(Color(0xFFFF5686), parseHexColor("ff5686"))
        assertEquals(ColorSpaces.Srgb, parseHexColor("#000000")!!.colorSpace)
        assertNull(parseHexColor("#FFF"))
        assertNull(parseHexColor("#GG0000"))
        assertNull(parseHexColor(null))
    }

    @Test
    fun `legible ink darkens a tint until it reads on the grouped background`() {
        assertRgb(doubleArrayOf(0.52000, 0.40784, 0.08361), LegibleInk.resolve(SettingsTint.yellow, dark = false))
        assertRgb(doubleArrayOf(1.0, 0.78431, 0.16078), LegibleInk.resolve(SettingsTint.yellow, dark = true))
        assertRgb(doubleArrayOf(0.37000, 0.29020, 0.05949), LegibleInk.resolve(SettingsTint.yellow, dark = false, increasedContrast = true))
        assertRgb(doubleArrayOf(0.17749, 0.48094, 0.13169), LegibleInk.resolve(SettingsTint.green, dark = false))
        assertRgb(doubleArrayOf(0.41514, 0.42133, 0.43682), LegibleInk.resolve(SettingsTint.neutral, dark = false))
        assertRgb(doubleArrayOf(0.0, 0.40667, 0.85000), LegibleInk.resolve(ardiaColor(0x007AFF), dark = false))
        assertRgb(doubleArrayOf(0.06000, 0.50973, 1.0), LegibleInk.resolve(ardiaColor(0x007AFF), dark = true))
        assertRgb(doubleArrayOf(0.02392, 0.31576, 0.61000), LegibleInk.resolve(ardiaColor(0x0A84FF), dark = false, increasedContrast = true))
    }

    @Test
    fun `contrast is the WCAG ratio`() {
        assertEquals(21.0, ColorMath.contrast(Color.Black, Color.White), 0.01)
        assertEquals(1.0, ColorMath.contrast(SettingsTint.blue, SettingsTint.blue), 1e-9)
    }

    @Test
    fun `adaptive colours pick by appearance`() {
        assertEquals(ardiaColor(0x6395FC), BrowsePalette.loadingBorder.resolve(dark = false))
        assertEquals(ardiaColor(0x4A77D4), BrowsePalette.loadingBorder.resolve(dark = true))
        assertEquals(ardiaColor(0x007AFF), BrowsePalette.searchAccent.resolve(dark = false))
    }
}
