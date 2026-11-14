package com.ardia.phone

import com.ardia.design.FaviconTone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FaviconPayloadsTest {
    private val clear = 0x00000000
    private val black = 0xFF000000.toInt()
    private val white = 0xFFFFFFFF.toInt()

    private fun icon(ink: Int, inkShare: Double): IntArray = IntArray(256) { if (it < (256 * inkShare).toInt()) ink else clear }

    @Test
    fun aDarkIconOnAClearBackgroundIsTheOneThatNeedsALightBackingInDarkMode() {
        assertEquals("darkOnClear", FaviconPayloads.tone(FaviconTone.measure(icon(black, 0.4))))
        assertEquals("lightOnClear", FaviconPayloads.tone(FaviconTone.measure(icon(white, 0.4))))
        assertEquals("opaque", FaviconPayloads.tone(FaviconTone.measure(icon(black, 1.0))))
        assertEquals("blank", FaviconPayloads.tone(FaviconTone.measure(icon(black, 0.0))))
        assertEquals(mapOf("tone" to "darkOnClear", "backing" to "light"), FaviconPayloads.look(FaviconTone.DarkOnClear, dark = true))
        assertEquals(mapOf("tone" to "darkOnClear", "backing" to null), FaviconPayloads.look(FaviconTone.DarkOnClear, dark = false))
        assertEquals(mapOf("tone" to "lightOnClear", "backing" to "dark"), FaviconPayloads.look(FaviconTone.LightOnClear, dark = false))
        assertNull(FaviconPayloads.look(FaviconTone.Opaque, dark = true)["backing"])
    }
}
