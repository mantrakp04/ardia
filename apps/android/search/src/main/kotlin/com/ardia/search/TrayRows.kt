package com.ardia.search

import com.ardia.store.SearchSuggestion

sealed interface TrayRow {
    val key: String

    data class Suggested(val suggestion: SearchSuggestion) : TrayRow {
        override val key: String get() = suggestion.id
    }

    data class Paste(val offer: ClipboardOffer) : TrayRow {
        override val key: String get() = PASTE_KEY
    }

    companion object {
        const val PASTE_KEY = "paste"
    }
}

object TrayRows {
    fun build(suggestions: List<SearchSuggestion>, typed: String, paste: ClipboardOffer?): List<TrayRow> {
        val rows = ArrayList<TrayRow>(suggestions.size + 1)
        if (typed.isBlank() && paste != null) rows.add(TrayRow.Paste(paste))
        suggestions.mapTo(rows) { TrayRow.Suggested(it) }
        return rows
    }

    fun isRefinable(row: TrayRow): Boolean =
        row is TrayRow.Suggested && row.suggestion.kind == SearchSuggestion.Kind.Query && row.suggestion.query.isNotBlank()

    fun refinedText(suggestion: SearchSuggestion): String = suggestion.query.trim() + " "

    fun queryPrefixLength(title: String, typed: String): Int {
        val needle = typed.trim()
        if (needle.isEmpty() || title.length <= needle.length) return 0
        return if (title.startsWith(needle, ignoreCase = true)) needle.length else 0
    }

    fun leavesSearch(suggestion: SearchSuggestion): Boolean = suggestion.kind != SearchSuggestion.Kind.Calculation
}
