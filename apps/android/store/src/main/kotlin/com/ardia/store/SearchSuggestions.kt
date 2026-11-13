package com.ardia.store

data class SearchSuggestion(
    val id: String,
    val kind: Kind,
    val title: String,
    val detail: String?,
    val url: String?,
    val query: String,
    val favicon: String? = null,
    val copyValue: String? = null,
) {
    sealed interface Kind {
        data object Query : Kind

        data object Url : Kind

        data class OpenTab(val tabId: String) : Kind

        data class RemoteTab(val deviceName: String) : Kind

        data object History : Kind

        data object Bookmark : Kind

        data object Calculation : Kind
    }

    val showsFavicon: Boolean get() = kind != Kind.Query && kind != Kind.Calculation && url != null

    companion object {
        fun query(text: String) = SearchSuggestion("q:" + text.lowercase(), Kind.Query, text, null, null, text)
    }
}

object SearchSuggestions {
    const val ROW_LIMIT = 9
    const val IDLE_SEARCH_LIMIT = 3
    const val IDLE_ROW_LIMIT = 5

    fun rows(text: String, result: OmniboxResult, synced: SyncedBrowsing?, recentQueries: List<String>): List<SearchSuggestion> {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return idleRows(recentQueries, synced)
        val isCurrent = result.query == text
        val devices = macTabIndex(synced)
        val rows = ArrayList<SearchSuggestion>()
        val seen = HashSet<String>()
        for (suggestion in result.suggestions) {
            val row = row(suggestion, devices)
            if (row.id in seen) continue
            if (!isCurrent && !stillMatches(row, trimmed)) continue
            if (!isCurrent && row.kind == SearchSuggestion.Kind.Query && (row.url == null || !row.title.equals(trimmed, ignoreCase = true))) continue
            seen.add(row.id)
            rows.add(row)
            if (rows.size == ROW_LIMIT) break
        }
        if (rows.none { it.kind == SearchSuggestion.Kind.Query && it.title.equals(trimmed, ignoreCase = true) }) {
            val typed = SearchSuggestion.query(trimmed)
            rows.removeAll { it.id == typed.id }
            rows.add(minOf(if (isCurrent) 1 else 0, rows.size), typed)
            if (rows.size > ROW_LIMIT) rows.removeAt(rows.lastIndex)
        }
        return rows
    }

    fun idleRows(recentQueries: List<String>, synced: SyncedBrowsing?): List<SearchSuggestion> =
        (recentQueries.map(SearchSuggestion::query) + macRows(synced)).take(IDLE_ROW_LIMIT)

    fun stillMatches(row: SearchSuggestion, typed: String): Boolean {
        val needle = typed.lowercase()
        return row.title.lowercase().contains(needle) || row.url?.lowercase()?.contains(needle) == true
    }

    fun row(suggestion: OmniboxSuggestion, devices: Map<String, String>): SearchSuggestion = when (suggestion) {
        is OmniboxSuggestion.Search -> SearchSuggestion.query(suggestion.query).copy(
            id = "q:" + suggestion.url,
            url = suggestion.url,
            detail = if (suggestion.isBang) "Search ${suggestion.engine}" else null,
        )
        is OmniboxSuggestion.Page -> {
            val kind = when {
                suggestion.tabId != null -> SearchSuggestion.Kind.OpenTab(suggestion.tabId)
                devices[suggestion.url] != null -> SearchSuggestion.Kind.RemoteTab(devices.getValue(suggestion.url))
                suggestion.bookmarked -> SearchSuggestion.Kind.Bookmark
                suggestion.visited -> SearchSuggestion.Kind.History
                else -> SearchSuggestion.Kind.Url
            }
            val shownTitle = suggestion.title.ifEmpty { BrowserUrl.displayHost(suggestion.url) }
            SearchSuggestion("p:" + suggestion.url, kind, shownTitle, BrowserUrl.displayHost(suggestion.url), suggestion.url, suggestion.title, suggestion.favicon)
        }
        is OmniboxSuggestion.Calculation -> SearchSuggestion(
            "c:" + suggestion.expression, SearchSuggestion.Kind.Calculation, "= " + suggestion.value, suggestion.expression, suggestion.url,
            suggestion.expression, copyValue = suggestion.value,
        )
    }

    fun macTabIndex(synced: SyncedBrowsing?): Map<String, String> {
        val index = HashMap<String, String>()
        synced?.deviceTabs?.filter { it.isMac }?.forEach { device -> device.tabs.forEach { index.putIfAbsent(it.url, device.deviceName) } }
        return index
    }

    private fun macRows(synced: SyncedBrowsing?): List<SearchSuggestion> {
        val device = synced?.deviceTabs?.firstOrNull { it.isMac && !it.isCurrent && it.tabs.isNotEmpty() } ?: return emptyList()
        return device.tabs.filter { BrowserUrl.isSyncable(it.url) }.take(3).map { tab ->
            SearchSuggestion(
                "r:" + tab.url, SearchSuggestion.Kind.RemoteTab(device.deviceName), tab.title.ifEmpty { tab.url }, BrowserUrl.displayHost(tab.url),
                tab.url, tab.title,
            )
        }
    }
}

object SearchInput {
    sealed interface Destination {
        data class Url(val url: String) : Destination

        data class Search(val query: String) : Destination
    }

    fun resolve(raw: String): Destination? {
        val text = raw.trim()
        if (text.isEmpty()) return null
        return url(text)?.let(Destination::Url) ?: Destination.Search(text)
    }

    fun url(text: String): String? {
        val lower = text.lowercase()
        if (text.contains(' ') && !lower.startsWith("http")) return null
        if (lower.startsWith("http://") || lower.startsWith("https://")) return text.replace(" ", "%20")
        if (lower.startsWith("about:") || lower.startsWith("ardia:")) return null
        val hostPart = lower.substringBefore('/')
        val hostOnly = hostPart.substringBefore(':')
        if (hostOnly == "localhost" || isIPv4(hostOnly)) return "http://$text"
        val labels = hostOnly.split('.')
        val tld = labels.lastOrNull() ?: return null
        if (labels.size < 2 || labels.any { it.isEmpty() }) return null
        if (tld.length < 2 || !(tld.all { it.isLetter() } || tld.startsWith("xn--"))) return null
        if (!hostOnly.all { it.isLetterOrDigit() || it == '-' || it == '.' }) return null
        return "https://$text"
    }

    fun isIPv4(text: String): Boolean {
        val parts = text.split('.')
        return parts.size == 4 && parts.all { part -> part.isNotEmpty() && part.toIntOrNull()?.let { it in 0..255 } == true }
    }
}
