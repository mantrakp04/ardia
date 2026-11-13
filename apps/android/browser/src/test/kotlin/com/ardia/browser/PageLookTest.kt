package com.ardia.browser

import android.webkit.WebViewClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PageLookTest {
    @Test
    fun cssColorsParseToOpaqueColors() {
        assertEquals(0xFF0A141E.toInt(), PageColors.parseCss("rgb(10, 20, 30)"))
        assertEquals(0xFF0A141E.toInt(), PageColors.parseCss("rgba(10, 20, 30, 0.9)"))
        assertEquals(0xFF0A141E.toInt(), PageColors.parseCss("rgb(10 20 30 / 90%)"))
        assertNull(PageColors.parseCss("rgba(10, 20, 30, 0.4)"))
        assertNull(PageColors.parseCss("transparent"))
        assertNull(PageColors.parseCss(null))
    }

    @Test
    fun hexRoundTrips() {
        assertEquals(0xFF336699.toInt(), PageColors.parseHex("#336699"))
        assertEquals("#336699", PageColors.hex(0xFF336699.toInt()))
        assertNull(PageColors.parseHex("#369"))
    }

    @Test
    fun darknessUsesTheIphoneThreshold() {
        assertTrue(PageColors.isDark(PageColors.opaque(18, 18, 20)))
        assertFalse(PageColors.isDark(PageColors.opaque(255, 255, 255)))
        assertFalse(PageColors.isDark(PageColors.opaque(128, 128, 128)))
    }

    @Test
    fun dominantColorNeedsAThirdOfTheBand() {
        val white = PageColors.opaque(250, 250, 250)
        val red = PageColors.opaque(200, 10, 10)
        val mostlyWhite = IntArray(64) { if (it < 40) white else red }
        assertEquals(white, ToneSampler.dominant(mostlyWhite))
        val noise = IntArray(64) { PageColors.opaque(it * 4, 255 - it * 4, (it * 37) % 256) }
        assertNull(ToneSampler.dominant(noise))
        assertNull(ToneSampler.dominant(IntArray(0)))
    }

    @Test
    fun aCaptureWithNothingInItIsBlank() {
        val black = 0xFF000000.toInt()
        assertTrue(CaptureCheck.isBlank(IntArray(0), blackIsBlank = false))
        assertTrue(CaptureCheck.isBlank(IntArray(16), blackIsBlank = false))
        assertTrue(CaptureCheck.isBlank(IntArray(16) { black }, blackIsBlank = true))
        assertFalse(CaptureCheck.isBlank(IntArray(16) { black }, blackIsBlank = false))
        assertFalse(CaptureCheck.isBlank(IntArray(16) { if (it == 3) PageColors.opaque(208, 16, 16) else black }, blackIsBlank = true))
        assertFalse(CaptureCheck.isBlank(IntArray(16) { PageColors.opaque(255, 255, 255) }, blackIsBlank = true))
    }

    @Test
    fun aFrameThatIsOneColourAlmostEverywhereIsNearlyUniform() {
        val white = PageColors.opaque(255, 255, 255)
        val text = PageColors.opaque(20, 20, 20)
        assertTrue(CaptureCheck.isNearlyUniform(IntArray(1024) { white }))
        assertTrue(CaptureCheck.isNearlyUniform(IntArray(1024) { if (it % 2 == 0) white else PageColors.opaque(252, 251, 253) }))
        assertTrue(CaptureCheck.isNearlyUniform(IntArray(1024) { if (it < 1020) white else text }))
        assertFalse(CaptureCheck.isNearlyUniform(IntArray(1024) { if (it < 960) white else text }))
        val sliceAtTheBottom = IntArray(1024) { if (it < 1024 - 64) white else PageColors.opaque(208, 16, 16) }
        assertFalse(CaptureCheck.isNearlyUniform(sliceAtTheBottom))
    }

    @Test
    fun toneMatchesTheIphonePriorities() {
        val theme = 1
        val background = 2
        val sampled = PageTone(top = 3, bottom = 4)
        val stored = 5
        assertEquals(PageTone(theme, 4), PageTone.resolve(theme, background, sampled, stored))
        assertEquals(PageTone(3, 4), PageTone.resolve(null, background, sampled, stored))
        assertEquals(PageTone(background, background), PageTone.resolve(null, background, null, stored))
        assertEquals(PageTone(theme, theme), PageTone.resolve(theme, null, null, stored))
        assertEquals(PageTone(stored, stored), PageTone.resolve(null, null, null, stored))
    }

    @Test
    fun networkErrorsBecomeTheIphoneFailures() {
        assertEquals(NetworkFailure.HostNotFound, NetworkFailure.fromWebViewError(WebViewClient.ERROR_HOST_LOOKUP, isOnline = true))
        assertEquals(NetworkFailure.Offline, NetworkFailure.fromWebViewError(WebViewClient.ERROR_HOST_LOOKUP, isOnline = false))
        assertEquals(NetworkFailure.TimedOut, NetworkFailure.fromWebViewError(WebViewClient.ERROR_TIMEOUT, isOnline = true))
        assertEquals(NetworkFailure.ConnectionLost, NetworkFailure.fromWebViewError(WebViewClient.ERROR_CONNECT, isOnline = true))
        assertEquals(NetworkFailure.NotPrivate, NetworkFailure.fromWebViewError(WebViewClient.ERROR_FAILED_SSL_HANDSHAKE, isOnline = false))
        assertEquals(NetworkFailure.Other, NetworkFailure.fromWebViewError(WebViewClient.ERROR_BAD_URL, isOnline = true))
        assertTrue(PageLoadFailure.Network(NetworkFailure.Offline).retriesWhenOnline)
        assertFalse(PageLoadFailure.Crashed.retriesWhenOnline)
    }

    @Test
    fun userAgentsLookLikeChromeWithoutTheWebViewMarks() {
        val system = "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36"
        val mobile = BrowserUserAgent.mobile(system)
        assertEquals("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", mobile)
        val desktop = BrowserUserAgent.desktop(system)
        assertTrue(desktop.contains("X11; Linux x86_64"))
        assertFalse(desktop.contains("Mobile"))
        assertFalse(desktop.contains("wv"))
        assertTrue(BrowserUserAgent.mobile("odd agent").contains("Chrome/140.0.0.0"))
    }
}
