package com.ardia.tabs

import com.ardia.design.ColorMath
import com.ardia.design.TabsPalette
import com.ardia.design.parseHexColor
import com.ardia.store.BrowserTab
import com.ardia.store.BrowserUrl
import com.ardia.store.TabOrigin
import java.time.LocalDate

object TabText {
    fun title(tab: BrowserTab, newTab: String): String = tab.title.trim().ifEmpty { host(tab, newTab) }

    fun host(tab: BrowserTab, newTab: String): String = BrowserUrl.host(tab.url) ?: newTab

    fun isUnseenReceived(tab: BrowserTab): Boolean = tab.origin == TabOrigin.SENT && tab.receivedKey != null && tab.lastActive <= tab.created

    fun remoteTitle(title: String, url: String): String = title.ifEmpty { BrowserUrl.host(url) ?: url }
}

object ThemeInk {
    fun isLight(hex: String?): Boolean {
        val color = parseHexColor(hex) ?: return true
        return ColorMath.relativeLuminance(color) > 0.36
    }
}

object PlaceholderTint {
    fun index(url: String, count: Int): Int {
        val host = BrowserUrl.host(url) ?: url
        var value = 5381u
        for (scalar in host.codePoints()) value = (value shl 5) + value + scalar.toUInt()
        return (value % count.toUInt()).toInt()
    }

    fun hex(url: String, dark: Boolean): Long {
        val tints = if (dark) TabsPalette.placeholderTintsDark else TabsPalette.placeholderTints
        return tints[index(url, tints.size)]
    }
}

sealed interface ArchiveDayLabel {
    data object Today : ArchiveDayLabel

    data object Yesterday : ArchiveDayLabel

    data class Weekday(val day: LocalDate) : ArchiveDayLabel

    data class MonthDay(val day: LocalDate) : ArchiveDayLabel

    data class MonthDayYear(val day: LocalDate) : ArchiveDayLabel

    companion object {
        fun of(day: LocalDate, today: LocalDate): ArchiveDayLabel = when {
            day == today -> Today
            day == today.minusDays(1) -> Yesterday
            !day.isBefore(today.minusDays(6)) -> Weekday(day)
            day.year == today.year -> MonthDay(day)
            else -> MonthDayYear(day)
        }
    }
}
