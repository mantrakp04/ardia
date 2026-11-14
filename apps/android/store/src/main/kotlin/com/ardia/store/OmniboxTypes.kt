package com.ardia.store

import kotlinx.serialization.Serializable

sealed interface OmniboxSuggestion {
    val id: String
    val url: String

    data class Page(
        override val url: String,
        val title: String,
        val favicon: String?,
        val tabId: String?,
        val bookmarked: Boolean,
        val visited: Boolean,
    ) : OmniboxSuggestion {
        override val id: String get() = (if (tabId == null) "page:" else "tab:") + url
    }

    data class Search(val query: String, override val url: String, val engine: String, val suggested: Boolean, val isBang: Boolean) : OmniboxSuggestion {
        override val id: String get() = "search:$url"
    }

    data class Calculation(val expression: String, val value: String, override val url: String) : OmniboxSuggestion {
        override val id: String get() = "calc:$expression"
    }
}

data class OmniboxResult(val query: String, val suggestions: List<OmniboxSuggestion>, val inlineCompletion: String) {
    val completion: CompletionOffer?
        get() = if (query.isEmpty()) null else CompletionOffer(query, if (inlineCompletion.isEmpty()) null else query + inlineCompletion)

    companion object {
        val empty = OmniboxResult("", emptyList(), "")
    }
}

data class OmniboxResolution(val kind: Kind, val url: String, val query: String, val engine: String) {
    enum class Kind { URL, SEARCH, BANG }
}

@Serializable
data class SearchEngineInfo(val id: String, val name: String, val url: String, val suggests: Boolean? = null, val custom: Boolean? = null)

@Serializable
data class DisplayUrl(val display: String, val host: String, val trail: List<String>)

data class OmniboxContext(
    val currentUrl: String? = null,
    val currentTabId: String? = null,
    val prefersSearch: Boolean = false,
    val preventInline: Boolean = false,
)

@Serializable
data class CandidateTab(val id: String, val url: String, val title: String, val favicon: String? = null)

@Serializable
data class HistoryRow(val url: String, val title: String, val favicon: String? = null, val visits: Int, val lastVisit: Double)

@Serializable
data class CandidateBookmark(val url: String, val title: String, val favicon: String? = null)

@Serializable
data class OmniboxCandidates(
    val tabs: List<CandidateTab> = emptyList(),
    val history: List<HistoryRow> = emptyList(),
    val bookmarks: List<CandidateBookmark> = emptyList(),
) {
    companion object {
        fun merge(openTabs: List<CandidateTab>, localHistory: List<HistoryRow>, synced: SyncedBrowsing?, now: Long = System.currentTimeMillis()): OmniboxCandidates {
            val history = LinkedHashMap<String, HistoryRow>()
            fun add(row: HistoryRow) {
                val existing = history[row.url]
                history[row.url] = if (existing == null) {
                    row
                } else {
                    existing.copy(
                        visits = maxOf(existing.visits, row.visits),
                        lastVisit = maxOf(existing.lastVisit, row.lastVisit),
                        title = existing.title.ifEmpty { row.title },
                        favicon = existing.favicon ?: row.favicon,
                    )
                }
            }
            localHistory.forEach(::add)
            if (synced != null) {
                synced.history.forEach(::add)
                val seenAt = (synced.syncedAt ?: now).toDouble()
                for (device in synced.deviceTabs) {
                    if (device.isCurrent) continue
                    for (tab in device.tabs) if (BrowserUrl.isSyncable(tab.url)) add(HistoryRow(tab.url, tab.title, null, 1, seenAt))
                }
            }
            return OmniboxCandidates(openTabs, history.values.toList(), synced?.bookmarks.orEmpty())
        }
    }
}

data class SyncedBrowsing(
    val history: List<HistoryRow> = emptyList(),
    val deviceTabs: List<DeviceTabs> = emptyList(),
    val bookmarks: List<CandidateBookmark> = emptyList(),
    val syncedAt: Long? = null,
) {
    data class DeviceTabs(val deviceId: String, val deviceName: String, val isMac: Boolean, val isCurrent: Boolean, val tabs: List<RemoteTab>)

    data class RemoteTab(val url: String, val title: String)
}

@Serializable
internal data class RawSuggestionResult(val items: List<Item> = emptyList(), val completion: String = "") {
    @Serializable
    data class Item(
        val kind: String,
        val url: String? = null,
        val title: String? = null,
        val favicon: String? = null,
        val tabId: String? = null,
        val bookmarked: Boolean? = null,
        val visited: Boolean? = null,
        val query: String? = null,
        val engine: String? = null,
        val suggested: Boolean? = null,
        val bang: Boolean? = null,
        val expression: String? = null,
        val value: String? = null,
    )

    fun result(query: String): OmniboxResult = OmniboxResult(
        query,
        items.mapNotNull { item ->
            when (item.kind) {
                "page" -> item.url?.let {
                    OmniboxSuggestion.Page(it, item.title.orEmpty(), item.favicon, item.tabId, item.bookmarked ?: false, item.visited ?: false)
                }
                "search" -> if (item.url != null && item.query != null) {
                    OmniboxSuggestion.Search(item.query, item.url, item.engine.orEmpty(), item.suggested ?: false, item.bang ?: false)
                } else {
                    null
                }
                "calc" -> if (item.url != null && item.expression != null && item.value != null) {
                    OmniboxSuggestion.Calculation(item.expression, item.value, item.url)
                } else {
                    null
                }
                else -> null
            }
        },
        completion,
    )
}

@Serializable
internal data class RawResolution(val kind: String, val url: String, val query: String, val engine: String)
