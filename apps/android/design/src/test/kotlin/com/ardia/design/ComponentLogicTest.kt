package com.ardia.design

import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class FaviconLogicTest {
    private fun pixels(count: Int, coveredColor: Int, covered: Int): IntArray = IntArray(count) { if (it < covered) coveredColor else 0 }

    @Test
    fun `tone reads coverage and brightness like the iPhone`() {
        assertEquals(FaviconTone.Opaque, FaviconTone.measure(pixels(256, 0xFFFF0000.toInt(), 256)))
        assertEquals(FaviconTone.Blank, FaviconTone.measure(pixels(256, 0xFF000000.toInt(), 10)))
        assertEquals(FaviconTone.DarkOnClear, FaviconTone.measure(pixels(256, 0xFF101010.toInt(), 120)))
        assertEquals(FaviconTone.LightOnClear, FaviconTone.measure(pixels(256, 0xFFF8F8F8.toInt(), 120)))
        assertEquals(FaviconTone.Mixed, FaviconTone.measure(pixels(256, 0xFF3A8DDE.toInt(), 120)))
        assertEquals(FaviconTone.Blank, FaviconTone.measure(pixels(256, 0x40FFFFFF, 256)))
    }

    @Test
    fun `a plate goes behind icons that would vanish on the background`() {
        assertEquals(Color.White.copy(alpha = 0.92f), FaviconPlate.color(FaviconTone.DarkOnClear, dark = true))
        assertNull(FaviconPlate.color(FaviconTone.DarkOnClear, dark = false))
        assertEquals(Color.Black.copy(alpha = 0.78f), FaviconPlate.color(FaviconTone.LightOnClear, dark = false))
        assertNull(FaviconPlate.color(FaviconTone.Opaque, dark = true))
    }

    @Test
    fun `the monogram letter and tint match the iPhone's hash`() {
        assertEquals(582405892u, Monogram.hash("apple.com"))
        assertEquals(4129370451u, Monogram.hash("en.wikipedia.org"))
        assertEquals(0x3A8DDEL, Monogram.tintHex("apple.com"))
        assertEquals(0x8A5CC7L, Monogram.tintHex("en.wikipedia.org"))
        assertEquals(0x5E6AD2L, Monogram.tintHex("dpreview.com"))
        assertEquals(0x8E8E93L, Monogram.tintHex(null))
        assertEquals("apple.com", Monogram.host("https://WWW.Apple.com/iphone"))
        assertEquals("G", Monogram.letter("github.com"))
        assertEquals("1", Monogram.letter("-1password.com"))
        assertNull(Monogram.letter("--"))
        assertNull(Monogram.host("not a url"))
    }

    @Test
    fun `candidates try the page's icon, then its favicon dot ico, web only`() {
        assertEquals(
            listOf("https://cdn.example/icon.png", "https://example.com/favicon.ico"),
            FaviconCandidates.of("https://cdn.example/icon.png", "https://example.com/a/b?c=d"),
        )
        assertEquals(listOf("https://example.com/favicon.ico"), FaviconCandidates.of("data:image/png;base64,AA", "https://example.com/"))
        assertEquals(listOf("https://example.com/favicon.ico"), FaviconCandidates.of("https://example.com/favicon.ico", "https://example.com/"))
        assertTrue(FaviconCandidates.of(null, "file:///etc/hosts").isEmpty())
    }

    @Test
    fun `disk names are stable hashes, not URLs`() {
        val name = FaviconCache.fileName("https://example.com/favicon.ico")
        assertEquals(name, FaviconCache.fileName("https://example.com/favicon.ico"))
        assertTrue(name.matches(Regex("[0-9a-f]{32}\\.png")))
    }
}

class PlaceholderLogicTest {
    @Test
    fun `a title that only repeats the host is dropped`() {
        assertNull(PlaceholderText.distinctTitle("www.Example.com", "example.com", "New Tab"))
        assertNull(PlaceholderText.distinctTitle("https://example.com/x", "example.com", "New Tab"))
        assertNull(PlaceholderText.distinctTitle("  ", "example.com", "New Tab"))
        assertEquals("New Tab", PlaceholderText.distinctTitle("", null, "New Tab"))
        assertEquals("Lisbon", PlaceholderText.distinctTitle(" Lisbon ", "en.wikipedia.org", "New Tab"))
    }

    @Test
    fun `a page theme picks readable ink and ignores near white`() {
        val dark = PageTheme.parse("#1A1A2E")!!
        assertEquals(Color.White.copy(alpha = 0.92f), dark.ink)
        val light = PageTheme.parse("FFD60A")!!
        assertEquals(Color.Black.copy(alpha = 0.85f), light.ink)
        assertNull(PageTheme.parse("#FFFFFF"))
        assertNull(PageTheme.parse("#12345"))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ToastCenterTest {
    private val icon = ArdiaSymbols.link

    @Test
    fun `a toast goes away after its duration`() = runTest {
        val center = ToastCenter(this)
        center.show(Toast("Copied URL", icon))
        advanceTimeBy(Toast.DEFAULT_DURATION_MILLIS - 1)
        runCurrent()
        assertTrue(center.current != null)
        advanceTimeBy(2)
        runCurrent()
        assertNull(center.current)
    }

    @Test
    fun `the same message again keeps the toast and restarts its clock`() = runTest {
        val center = ToastCenter(this)
        val first = Toast("Copied URL", icon)
        center.show(first)
        advanceTimeBy(2_000)
        center.show(Toast("Copied URL", icon))
        assertSame(first, center.current)
        advanceTimeBy(2_000)
        runCurrent()
        assertSame(first, center.current)
        advanceTimeBy(500)
        runCurrent()
        assertNull(center.current)
    }

    @Test
    fun `a new message replaces the old one`() = runTest {
        val center = ToastCenter(this)
        center.show(Toast("Copied URL", icon))
        val second = Toasts.sentTab("MacBook Pro")
        center.show(second)
        assertSame(second, center.current)
        advanceTimeBy(Toast.DEFAULT_DURATION_MILLIS + 1)
        runCurrent()
        assertNull(center.current)
    }

    @Test
    fun `holding keeps it up and letting go gives it 1_2 seconds`() = runTest {
        val center = ToastCenter(this)
        center.show(Toast("Copied URL", icon))
        center.hold(true)
        advanceTimeBy(10_000)
        runCurrent()
        assertTrue(center.current != null)
        center.hold(false)
        advanceTimeBy(ToastCenter.RELEASE_MILLIS - 1)
        runCurrent()
        assertTrue(center.current != null)
        advanceTimeBy(2)
        runCurrent()
        assertNull(center.current)
    }

    @Test
    fun `tapping dismisses first, then runs the action`() = runTest {
        val center = ToastCenter(this)
        var seenWhileRunning: Toast? = Toast("sentinel", icon)
        center.show(Toasts.downloaded("report.pdf") { seenWhileRunning = center.current })
        center.activate()
        assertNull(seenWhileRunning)
        assertNull(center.current)
    }

    @Test
    fun `received tabs say who sent them and pick the device glyph`() {
        assertEquals("Luke's MacBook Pro", ReceivedTabsSender.name(listOf(" Luke's MacBook Pro ", null, "Luke's MacBook Pro"), "Your Mac"))
        assertEquals("Your Mac", ReceivedTabsSender.name(listOf("A", "B"), "Your Mac"))
        assertEquals("Your Mac", ReceivedTabsSender.name(listOf(null, " "), "Your Mac"))
        assertSame(ArdiaSymbols.iphone, Toasts.tabReceived("Luke's iPhone").icon)
        assertSame(ArdiaSymbols.macbook, Toasts.tabReceived("Studio").icon)
        assertEquals(Toast.LONG_DURATION_MILLIS, Toasts.tabReceived("Studio", count = 3).durationMillis)
        assertEquals(ToastText.Plural(R.plurals.ardia_toast_tabs_from, 3, listOf(3, "Studio")), Toasts.tabReceived("Studio", count = 3).message)
    }
}
