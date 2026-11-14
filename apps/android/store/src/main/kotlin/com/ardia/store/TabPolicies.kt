package com.ardia.store

import java.net.URI
import java.time.LocalDate

private const val HOUR = 3_600_000L

enum class AutoArchiveInterval(val raw: String, val durationMillis: Long?) {
    ONE_HOUR("oneHour", HOUR),
    FOUR_HOURS("fourHours", 4 * HOUR),
    TWELVE_HOURS("twelveHours", 12 * HOUR),
    DAY("day", 24 * HOUR),
    THREE_DAYS("threeDays", 72 * HOUR),
    WEEK("week", 168 * HOUR),
    NEVER("never", null);

    val title: String
        get() {
            val duration = durationMillis ?: return "Never"
            val amount = if (duration >= 24 * HOUR) plural(duration / (24 * HOUR), "day") else plural(duration / HOUR, "hour")
            return "After $amount"
        }

    companion object {
        val standard = DAY

        fun of(raw: String?): AutoArchiveInterval? = entries.firstOrNull { it.raw == raw }

        private fun plural(count: Long, unit: String) = if (count == 1L) "1 $unit" else "$count ${unit}s"
    }
}

object AutoArchivePolicy {
    fun isDue(lastActive: Long, now: Long, interval: AutoArchiveInterval, isBeingViewed: Boolean): Boolean {
        val duration = interval.durationMillis ?: return false
        if (isBeingViewed || lastActive > now) return false
        return now - lastActive >= duration
    }
}

sealed interface TabDestination {
    data class Url(val url: String, val origin: TabOrigin = TabOrigin.TYPED) : TabDestination

    data class Search(val query: String) : TabDestination

    data class Sent(val tab: IncomingTab) : TabDestination
}

sealed interface TabPlacement {
    data object End : TabPlacement

    data class After(val id: String) : TabPlacement
}

data class ArchivedDay(val day: LocalDate, val tabs: List<BrowserTab>)

object BrowserUrl {
    const val BROWSE_SCHEME = "ardia"

    private val unreserved = "-_.!~*'()"
    private val authority = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?(\\[[^\\]]*\\]|[^:/?#]*)")

    fun isSyncable(url: String): Boolean {
        val lower = url.lowercase()
        return lower.startsWith("https://") || lower.startsWith("http://")
    }

    fun searchUrl(template: String, query: String): String {
        val encoded = encodeUriComponent(query.trim())
        return if (template.contains("%s")) template.replace("%s", encoded) else template + encoded
    }

    fun encodeUriComponent(text: String): String {
        val out = StringBuilder()
        for (byte in text.toByteArray(Charsets.UTF_8)) {
            val code = byte.toInt() and 0xFF
            val char = code.toChar()
            val plain = code < 128 && (char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char in unreserved)
            if (plain) out.append(char) else out.append('%').append("%02X".format(code))
        }
        return out.toString()
    }

    fun host(url: String): String? {
        val parsed = runCatching { URI(url).host }.getOrNull()
        val host = (parsed ?: authority.find(url)?.groupValues?.get(1))?.lowercase()
        if (host.isNullOrEmpty()) return null
        return host.removePrefix("www.")
    }

    fun displayHost(url: String): String = host(url) ?: url
}

internal object TabPositions {
    const val STEP = 1024.0

    fun between(lower: Double?, upper: Double?): Double? = when {
        lower == null && upper == null -> 0.0
        upper == null -> lower!! + STEP
        lower == null -> upper - STEP
        else -> {
            val middle = (lower + upper) / 2
            if (middle > lower && middle < upper && upper - lower > 1e-6) middle else null
        }
    }
}

object TabOrdering {
    fun recencyOrder(tabs: List<BrowserTab>, selectedId: String?): List<BrowserTab> = tabs.sortedWith { lhs, rhs ->
        when {
            lhs.id == rhs.id -> 0
            lhs.id == selectedId -> 1
            rhs.id == selectedId -> -1
            lhs.lastActive != rhs.lastActive -> lhs.lastActive.compareTo(rhs.lastActive)
            else -> lhs.position.compareTo(rhs.position)
        }
    }
}
