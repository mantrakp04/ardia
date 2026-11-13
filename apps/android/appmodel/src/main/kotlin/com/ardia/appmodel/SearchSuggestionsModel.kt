package com.ardia.appmodel

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.store.CandidateTab
import com.ardia.store.CompletionOffer
import com.ardia.store.Omnibox
import com.ardia.store.OmniboxContext
import com.ardia.store.OmniboxModel
import com.ardia.store.OmniboxResolution
import com.ardia.store.OmniboxResult
import com.ardia.store.SearchSuggestion
import com.ardia.store.SearchSuggestions
import com.ardia.store.SyncedBrowsing
import com.ardia.store.TabStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@Stable
class SearchSuggestionsModel internal constructor(
    source: Omnibox,
    parent: CoroutineScope,
    private val tabs: suspend () -> TabStore,
    private val synced: SyncedBrowsing?,
    private val recentQueries: () -> List<String>,
    fetchesNetworkSuggestions: Boolean,
    currentUrl: String?,
    currentTabId: String?,
) {
    private val scope = CoroutineScope(parent.coroutineContext + SupervisorJob(parent.coroutineContext[Job]))
    val omnibox = OmniboxModel(source, scope).apply {
        context = OmniboxContext(currentUrl = currentUrl, currentTabId = currentTabId)
        this.fetchesNetworkSuggestions = fetchesNetworkSuggestions
    }

    var text: String by mutableStateOf("")
        private set
    var result: OmniboxResult by mutableStateOf(OmniboxResult.empty)
        private set

    init {
        scope.launch { omnibox.result.collect { result = it } }
    }

    val completion: CompletionOffer? get() = result.completion

    val rows: List<SearchSuggestion> get() = SearchSuggestions.rows(text, result, synced, recentQueries())

    fun prepare(): Job = scope.launch {
        val tabs = tabs()
        val open = tabs.openTabs.map { CandidateTab(it.id, it.url, it.title, it.faviconUrl) }
        omnibox.refreshCandidates(open, { limit -> tabs.history.summary(limit) }, synced).join()
    }

    fun update(newText: String) {
        if (newText == text) return
        text = newText
        if (newText.isBlank()) omnibox.clear() else omnibox.update(newText)
    }

    fun cancel() {
        omnibox.clear()
    }

    suspend fun resolve(submitted: String): OmniboxResolution? = omnibox.resolve(submitted)

    fun close() {
        omnibox.close()
        scope.cancel()
    }
}
