package com.ardia.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class ProfileLookTest {
    private val macWindowTints = listOf(
        Triple(ProfileLook.Preset.Plum, listOf(0xE7CFD3L, 0xF2E7E9L), listOf(0x342123L, 0x3B3031L)),
        Triple(ProfileLook.Preset.Blue, listOf(0xD0DDE7L, 0xE7EDF2L), listOf(0x242A30L, 0x343537L)),
        Triple(ProfileLook.Preset.Purple, listOf(0xD2CFE7L, 0xE8E7F2L), listOf(0x262130L, 0x353037L)),
        Triple(ProfileLook.Preset.Pink, listOf(0xE7CFD3L, 0xF2E7E9L), listOf(0x342123L, 0x3B3031L)),
        Triple(ProfileLook.Preset.Red, listOf(0xE7CFD0L, 0xF2E7E7L), listOf(0x342121L, 0x3B3030L)),
        Triple(ProfileLook.Preset.Orange, listOf(0xE7D6CFL, 0xF2EAE6L), listOf(0x342520L, 0x3B3230L)),
        Triple(ProfileLook.Preset.Yellow, listOf(0xE7DFCFL, 0xF2EEE6L), listOf(0x342B20L, 0x3B3530L)),
        Triple(ProfileLook.Preset.Green, listOf(0xD0E7DEL, 0xE7F2EDL), listOf(0x24302AL, 0x343834L)),
        Triple(ProfileLook.Preset.Neutral, listOf(0xF0F0F0L, 0xF6F5F5L), listOf(0x1F1B1AL, 0x231F1EL)),
    )

    private fun isClose(stops: List<LookRgb>, expected: List<Long>): Boolean {
        if (stops.size != expected.size) return false
        return stops.zip(expected.map(LookRgb::fromHex)).all { (stop, want) ->
            abs(stop.red - want.red) <= 1.01 / 255 && abs(stop.green - want.green) <= 1.01 / 255 && abs(stop.blue - want.blue) <= 1.01 / 255
        }
    }

    @Test
    fun `the window tint matches the Mac for every profile color`() {
        assertEquals(ProfileLook.Preset.entries.size, macWindowTints.size)
        for ((preset, light, dark) in macWindowTints) {
            val look = ProfileLook.of(preset)
            assertTrue("$preset light", isClose(look.windowTintStops(dark = false), light))
            assertTrue("$preset dark", isClose(look.windowTintStops(dark = true), dark))
        }
    }

    @Test
    fun `the incognito tint matches the Mac`() {
        assertTrue(isClose(ProfileLook.incognito.windowTintStops(dark = true), listOf(0x1A1616L, 0x1E1A19L)))
    }

    @Test
    fun `profile color names are the Mac's, and plum is the default`() {
        assertEquals(ProfileLook.of(ProfileLook.Preset.Blue), ProfileLook.of("Blue"))
        assertEquals(ProfileLook.plum, ProfileLook.of("plum"))
        assertEquals(ProfileLook.plum, ProfileLook.of(null as String?))
        assertEquals(ProfileLook.plum, ProfileLook.of("indigo"))
        assertEquals(LookRgb.fromHex(0x4691C3), ProfileLook.of("#4691C3").swatch)
    }

    @Test
    fun `the backdrop is the Mac's window tint, and a Mac theme replaces it where themes show`() {
        for (dark in listOf(false, true)) {
            assertEquals(ProfileLook.plum.windowTintStops(dark), ProfileLook.plum.backdropStops(dark, themed = true))
        }
        val themed = ProfileLook.of("green", listOf("#4F7CFF", "#9B6BFF"), listOf("#1E2A5A", "#3A2466"))
        assertEquals(listOf("#4F7CFF", "#9B6BFF"), themed.backdropStops(dark = false, themed = true).map { it.hexString })
        assertEquals(listOf("#1E2A5A", "#3A2466"), themed.backdropStops(dark = true, themed = true).map { it.hexString })
        assertEquals(themed.windowTintStops(dark = false), themed.backdropStops(dark = false, themed = false))
        assertEquals(themed.windowTintStops(dark = true), themed.backdropStops(dark = true, themed = false))
        val lightOnly = ProfileLook.of("green", listOf("#4F7CFF", "#9B6BFF"))
        assertEquals(listOf("#4F7CFF", "#9B6BFF"), lightOnly.backdropStops(dark = true, themed = true).map { it.hexString })
        val oneColor = ProfileLook.of("blue", listOf("#4F7CFF"))
        assertEquals(oneColor.windowTintStops(dark = false), oneColor.backdropStops(dark = false, themed = true))
        assertEquals(ProfileLook.of(ProfileLook.Preset.Blue), ProfileLook.of("blue", listOf("nope")))
    }

    @Test
    fun `incognito is dark in both appearances`() {
        assertEquals(ProfileLook.incognito.windowTintStops(dark = true), ProfileLook.incognito.backdropStops(dark = false, themed = true))
        assertTrue(ProfileLook.incognito.inkIsLight(dark = false, themed = true))
    }

    @Test
    fun `text on the backdrop takes the ink that reads on it`() {
        for (preset in ProfileLook.Preset.entries) {
            val look = ProfileLook.of(preset)
            assertFalse("$preset light", look.inkIsLight(dark = false, themed = true))
            assertTrue("$preset dark", look.inkIsLight(dark = true, themed = true))
        }
        val deepTheme = ProfileLook.of("blue", listOf("#1E2A5A", "#3A2466"))
        assertTrue(deepTheme.inkIsLight(dark = false, themed = true))
        assertFalse(deepTheme.inkIsLight(dark = false, themed = false))
        val paleTheme = ProfileLook.of("blue", listOf("#F4E9D8", "#E9F4D8"))
        assertFalse(paleTheme.inkIsLight(dark = true, themed = true))
    }

    @Test
    fun `a look knows which of the Mac's colors it is`() {
        for (preset in ProfileLook.Preset.entries) {
            assertEquals(preset, ProfileLook.of(preset).preset)
            assertEquals(preset, ProfileLook.of(preset.key).preset)
        }
        assertNull(ProfileLook.of("green", listOf("#4F7CFF", "#9B6BFF")).preset)
    }

    @Test
    fun `the deck backdrop follows the profile color`() {
        for (dark in listOf(false, true)) {
            assertEquals(6, ProfileLook.plum.deckBaseStops(dark).size)
            assertEquals(3, ProfileLook.plum.deckBlobStops(dark).size)
            assertNotEquals(ProfileLook.of(ProfileLook.Preset.Green).deckBaseStops(dark), ProfileLook.plum.deckBaseStops(dark))
        }
        val grey = ProfileLook.of(ProfileLook.Preset.Neutral).deckBlobStops(dark = false)
        assertTrue(grey.all { it.hsl.saturation < 0.01 })
    }

    @Test
    fun `the app's look is the chosen color, else the synced profile, else plum`() {
        assertEquals(ProfileLook.of(ProfileLook.Preset.Green), ProfileLook.forApp("green", syncEnabled = true, profileColor = "blue"))
        assertEquals(ProfileLook.of(ProfileLook.Preset.Blue), ProfileLook.forApp(null, syncEnabled = true, profileColor = "blue"))
        assertEquals(ProfileLook.plum, ProfileLook.forApp(null, syncEnabled = false, profileColor = "blue"))
        assertEquals(ProfileLook.plum, ProfileLook.forApp(null, syncEnabled = true))
        assertEquals(ProfileLook.of(ProfileLook.Preset.Blue), ProfileLook.forApp("unknown", syncEnabled = true, profileColor = "blue"))
    }

    @Test
    fun `the surface tokens are the window tint stops`() {
        val look = ProfileLook.of(ProfileLook.Preset.Blue)
        assertEquals(ardiaColor(look.windowTintStops(dark = false)[0].hex), look.surface.light)
        assertEquals(ardiaColor(look.windowTintStops(dark = true)[1].hex), look.surfaceLow.dark)
    }

    @Test
    fun `hsl round trips and hex strings pad`() {
        val colour = LookRgb.fromHex(0xC07A98)
        val hsl = colour.hsl
        assertEquals(0xC07A98L, LookRgb.fromHsl(hsl.hue, hsl.saturation, hsl.lightness).hex)
        assertEquals("#00007A", LookRgb.fromHex(0x7A).hexString)
        assertNull(LookRgb.parse("#12"))
    }

    @Test
    fun `the colour picker's match toggle keeps the colour the look already has`() {
        assertTrue(ColorChoice.matchesMac(null))
        assertEquals(null, ColorChoice.choiceAfterMatchToggle(true, ProfileLook.of(ProfileLook.Preset.Red)))
        assertEquals("red", ColorChoice.choiceAfterMatchToggle(false, ProfileLook.of(ProfileLook.Preset.Red)))
        assertEquals("plum", ColorChoice.choiceAfterMatchToggle(false, ProfileLook.of("green", listOf("#4F7CFF", "#9B6BFF"))))
    }
}
