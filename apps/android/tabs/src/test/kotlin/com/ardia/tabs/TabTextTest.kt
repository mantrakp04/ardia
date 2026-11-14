package com.ardia.tabs

import com.ardia.design.TabsPalette
import com.ardia.store.BrowserTab
import com.ardia.store.TabOrigin
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TabTextTest {
    private fun tab(url: String, title: String = "", origin: TabOrigin = TabOrigin.TYPED, receivedKey: String? = null, lastActive: Long = 10) =
        BrowserTab(id = "t", url = url, title = title, created = 10, lastActive = lastActive, origin = origin, receivedKey = receivedKey)

    @Test
    fun aTabTitleFallsBackToItsHostThenToNewTab() {
        assertEquals("Lisbon", TabText.title(tab("https://en.wikipedia.org/wiki/Lisbon", "  Lisbon \n"), "New Tab"))
        assertEquals("apple.com", TabText.title(tab("https://www.apple.com/iphone/"), "New Tab"))
        assertEquals("New Tab", TabText.title(tab("about:blank"), "New Tab"))
    }

    @Test
    fun aReceivedTabIsUnseenUntilItIsOpened() {
        assertTrue(TabText.isUnseenReceived(tab("https://swift.org", origin = TabOrigin.SENT, receivedKey = "k")))
        assertFalse(TabText.isUnseenReceived(tab("https://swift.org", origin = TabOrigin.SENT, receivedKey = "k", lastActive = 11)))
        assertFalse(TabText.isUnseenReceived(tab("https://swift.org", origin = TabOrigin.LINK, receivedKey = "k")))
        assertFalse(TabText.isUnseenReceived(tab("https://swift.org", origin = TabOrigin.SENT)))
    }

    @Test
    fun aRemoteRowShowsItsHostWhenItHasNoTitle() {
        assertEquals("Notes", TabText.remoteTitle("Notes", "https://www.icloud.com/notes"))
        assertEquals("icloud.com", TabText.remoteTitle("", "https://www.icloud.com/notes"))
    }

    @Test
    fun themeInkIsDarkOnLightPagesAndLightOnDarkOnes() {
        assertTrue(ThemeInk.isLight("#FFFFFF"))
        assertFalse(ThemeInk.isLight("#1C1D22"))
        assertTrue(ThemeInk.isLight("not a colour"))
    }

    @Test
    fun placeholderTintsHashTheHostTheWayTheIphoneDoes() {
        var expected = 5381L
        for (char in "apple.com") expected = ((expected shl 5) + expected + char.code) and 0xFFFFFFFFL
        val index = (expected % TabsPalette.placeholderTints.size).toInt()
        assertEquals(index, PlaceholderTint.index("https://www.apple.com/iphone/", TabsPalette.placeholderTints.size))
        assertEquals(TabsPalette.placeholderTints[index], PlaceholderTint.hex("https://apple.com/mac/", dark = false))
        assertEquals(TabsPalette.placeholderTintsDark[index], PlaceholderTint.hex("https://apple.com/", dark = true))
    }

    @Test
    fun archiveDaysReadTodayYesterdayWeekdayThenDate() {
        val today = LocalDate.of(2026, 11, 13)
        assertEquals(ArchiveDayLabel.Today, ArchiveDayLabel.of(today, today))
        assertEquals(ArchiveDayLabel.Yesterday, ArchiveDayLabel.of(today.minusDays(1), today))
        assertEquals(ArchiveDayLabel.Weekday(today.minusDays(6)), ArchiveDayLabel.of(today.minusDays(6), today))
        assertEquals(ArchiveDayLabel.MonthDay(today.minusDays(7)), ArchiveDayLabel.of(today.minusDays(7), today))
        assertEquals(ArchiveDayLabel.MonthDayYear(LocalDate.of(2025, 12, 31)), ArchiveDayLabel.of(LocalDate.of(2025, 12, 31), today))
    }
}
