package com.ardia.store

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class OmniboxModel(
    val omnibox: Omnibox,
    private val scope: CoroutineScope,
    private val clock: StoreClock = StoreClock.system,
    private val networkDelayMillis: Long = NETWORK_DELAY_MILLIS,
    private val idleGapMillis: Long = IDLE_GAP_MILLIS,
) {
    fun interface HistorySource {
        suspend fun summary(limit: Int): List<HistoryRow>
    }

    private val _text = MutableStateFlow("")
    private val _result = MutableStateFlow(OmniboxResult.empty)
    private val _candidatesComplete = MutableStateFlow(false)

    val text: StateFlow<String> = _text.asStateFlow()
    val result: StateFlow<OmniboxResult> = _result.asStateFlow()
    val candidatesComplete: StateFlow<Boolean> = _candidatesComplete.asStateFlow()

    @Volatile var context: OmniboxContext = OmniboxContext()

    @Volatile var fetchesNetworkSuggestions: Boolean = true

    private var generation = 0
    private var localJob: Job? = null
    private var remoteJob: Job? = null
    private var candidatesJob: Job? = null
    private var remote: Pair<String, List<String>> = "" to emptyList()

    @Volatile private var lastKeystrokeAt = Long.MIN_VALUE / 2

    @Volatile private var suggestionsInFlight = 0

    val completion: CompletionOffer? get() = result.value.completion

    fun refreshCandidates(openTabs: List<CandidateTab>, history: HistorySource, synced: SyncedBrowsing?): Job {
        candidatesJob?.cancel()
        _candidatesComplete.value = false
        return scope.launch {
            if (!omnibox.hasHistory) {
                val seed = history.summary(SEED_ROWS)
                if (omnibox.setCandidates(OmniboxCandidates.merge(openTabs, seed, synced, clock.now()))) resuggest()
            }
            val full = history.summary(HistoryStore.SUMMARY_LIMIT)
            val candidates = OmniboxCandidates.merge(openTabs, full, synced, clock.now())
            awaitIdle()
            if (omnibox.setCandidates(candidates)) resuggest()
            _candidatesComplete.value = true
        }.also { candidatesJob = it }
    }

    fun update(next: String) {
        lastKeystrokeAt = clock.now()
        suggest(next)
    }

    private fun suggest(next: String) {
        _text.value = next
        generation++
        val mine = generation
        localJob?.cancel()
        remoteJob?.cancel()
        val query = next.trim()
        if (query.isEmpty()) {
            _result.value = OmniboxResult.empty
            return
        }
        val carried = carriedRemote(query)
        val context = context
        suggestionsInFlight++
        localJob = scope.launch {
            try {
                val local = omnibox.suggest(next, context, carried)
                if (generation == mine) _result.value = local
            } finally {
                suggestionsInFlight--
            }
        }
        if (!fetchesNetworkSuggestions) return
        remoteJob = scope.launch {
            delay(networkDelayMillis)
            val list = omnibox.remoteSuggestions(next)
            if (list.isEmpty()) return@launch
            val merged = omnibox.suggest(next, context, list)
            if (generation != mine) return@launch
            remote = query to list
            _result.value = merged
        }
    }

    suspend fun resolve(): OmniboxResolution? = omnibox.resolve(text.value)

    suspend fun resolve(submitted: String): OmniboxResolution? = omnibox.resolve(submitted)

    fun clear() {
        localJob?.cancel()
        remoteJob?.cancel()
        generation++
        _text.value = ""
        _result.value = OmniboxResult.empty
    }

    fun close() {
        clear()
        candidatesJob?.cancel()
    }

    private fun resuggest() {
        val current = text.value
        if (current.isNotEmpty()) suggest(current)
    }

    private suspend fun awaitIdle() {
        while (suggestionsInFlight > 0 || clock.now() - lastKeystrokeAt < idleGapMillis) delay(IDLE_POLL_MILLIS)
    }

    private fun carriedRemote(query: String): List<String> {
        val (text, list) = remote
        if (text == query) return list
        val lower = query.lowercase()
        if (text.isEmpty() || !lower.startsWith(text.lowercase())) return emptyList()
        return list.filter { it.lowercase().startsWith(lower) }
    }

    companion object {
        const val NETWORK_DELAY_MILLIS = 120L
        const val IDLE_GAP_MILLIS = 300L
        const val IDLE_POLL_MILLIS = 50L
        const val SEED_ROWS = 300
    }
}
