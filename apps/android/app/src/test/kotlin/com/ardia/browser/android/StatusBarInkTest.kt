package com.ardia.browser.android

import androidx.compose.ui.graphics.Color
import com.ardia.browser.android.StatusBarInk.Layer
import com.ardia.design.ProfileLook
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusBarInkTest {
    private val plum = ProfileLook.plum

    @Test
    fun thePageAndReaderAreLeftToBrowsing() {
        assertNull(StatusBarInk.darkIcons(Layer.Page, plum, dark = false, incognito = false))
    }

    @Test
    fun lightSurfacesGetDarkIconsAndDarkOnesLightIcons() {
        for (layer in listOf(Layer.Search, Layer.Deck, Layer.Sheet, Layer.Cover)) {
            assertEquals("$layer in light", true, StatusBarInk.darkIcons(layer, plum, dark = false, incognito = false))
            assertEquals("$layer in dark", false, StatusBarInk.darkIcons(layer, plum, dark = true, incognito = false))
        }
    }

    @Test
    fun aPrivateSearchIsDarkEvenInLightMode() {
        assertEquals(false, StatusBarInk.darkIcons(Layer.Search, plum, dark = false, incognito = true))
    }

    @Test
    fun everyColourChoiceKeepsIconsReadableInBothThemes() {
        for (preset in ProfileLook.Preset.entries) {
            val look = ProfileLook.of(preset)
            assertEquals(preset.key, true, StatusBarInk.darkIcons(Layer.Search, look, dark = false, incognito = false))
            assertEquals(preset.key, false, StatusBarInk.darkIcons(Layer.Search, look, dark = true, incognito = false))
        }
    }

    @Test
    fun theContrastMidpointSplitsWhiteFromBlack() {
        assertTrue(StatusBarInk.isLight(Color.White))
        assertFalse(StatusBarInk.isLight(Color.Black))
        assertFalse(StatusBarInk.isLight(Color(0xFF342123)))
        assertTrue(StatusBarInk.isLight(Color(0xFFE7CFD3)))
    }
}
