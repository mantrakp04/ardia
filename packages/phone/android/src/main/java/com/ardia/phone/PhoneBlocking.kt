package com.ardia.phone

import android.content.Context
import com.ardia.blocking.BlockingCategory
import com.ardia.blocking.BlockingSettings
import com.ardia.blocking.ContentBlocker
import com.ardia.blocking.ContentBlockerState
import com.ardia.blocking.FilterListState
import com.ardia.blocking.FilterLists
import com.ardia.blocking.FilterListsState
import com.ardia.blocking.HttpFilterListDownloader
import com.ardia.blocking.SharedPreferencesBlockingStore
import com.ardia.browser.PageFilter
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class PhoneBlocking(context: Context) {
    private val app = context.applicationContext
    private val preferences = app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val store = SharedPreferencesBlockingStore(preferences)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val mutableEnabled = MutableStateFlow(preferences.getBoolean(KEY_ENABLED, true))

    val settings = BlockingSettings(store)
    val lists = FilterLists(File(File(app.cacheDir, FOLDER), "Filters"), store, HttpFilterListDownloader())
    val blocker = ContentBlocker(settings, lists)
    val isEnabled: StateFlow<Boolean> = mutableEnabled.asStateFlow()

    val changes = combine(isEnabled, settings.state, lists.state, blocker.state) { _, _, _, _ -> Unit }

    @Volatile
    private var enabled = mutableEnabled.value

    fun start() {
        scope.launch {
            blocker.prepare()
            runCatching { blocker.refreshIfDue() }
        }
    }

    fun refreshIfDue() {
        scope.launch { runCatching { blocker.refreshIfDue() } }
    }

    suspend fun updateNow() = blocker.refreshIfDue(force = true)

    fun setEnabled(value: Boolean) {
        enabled = value
        preferences.edit().putBoolean(KEY_ENABLED, value).apply()
        mutableEnabled.value = value
    }

    fun setCategory(category: BlockingCategory, value: Boolean) = when (category) {
        BlockingCategory.ADS -> settings.blocksAds = value
        BlockingCategory.TRACKERS -> settings.blocksTrackers = value
        BlockingCategory.COOKIE_BANNERS -> settings.hidesCookieBanners = value
    }

    fun pageFilter(isPrivate: Boolean): PageFilter = EnginePageFilter(blocker.pageFilter(isPrivate)) { enabled }

    fun endPrivateBrowsing() = settings.endPrivateBrowsing()

    fun state(): Map<String, Any?> {
        val settingsState = settings.state.value
        val listsState = lists.state.value
        val blockerState = blocker.state.value
        return mapOf(
            "isEnabled" to enabled,
            "blocksAds" to settingsState.blocksAds,
            "blocksTrackers" to settingsState.blocksTrackers,
            "hidesCookieBanners" to settingsState.hidesCookieBanners,
            "exemptHosts" to settingsState.exemptHosts.sorted(),
            "status" to when (blockerState) {
                ContentBlockerState.Preparing -> "preparing"
                is ContentBlockerState.Ready -> "ready"
                is ContentBlockerState.Failed -> "failed"
            },
            "failure" to (blockerState as? ContentBlockerState.Failed)?.message,
            "isUpdating" to listsState.isUpdating,
            "isOffline" to listsState.isOffline,
            "lastUpdated" to listsState.lastUpdated?.toDouble(),
            "enabledRuleCount" to listsState.enabledRuleCount,
            "buildError" to listsState.buildError,
            "myFilters" to listsState.myFilters,
            "myFiltersRuleCount" to listsState.myFiltersResult.ruleCount,
            "myFiltersSkippedCount" to listsState.myFiltersResult.skippedCount,
            "lists" to lists(listsState),
        )
    }

    private fun lists(state: FilterListsState): List<Map<String, Any?>> = state.lists.map { list ->
        mapOf(
            "id" to list.id,
            "title" to list.title,
            "group" to list.group.title,
            "category" to list.category.rawValue,
            "sourceUrl" to list.sourceUrl,
            "supportUrl" to list.supportUrl,
            "languages" to list.languages,
            "isEnabled" to list.isEnabled,
            "isDefault" to list.isDefault,
            "isCustom" to list.isCustom,
            "ruleCount" to list.ruleCount,
            "skippedCount" to list.skippedCount,
            "updatedAt" to list.updatedAt?.toDouble(),
            "state" to listState(list.state),
            "failure" to (list.state as? FilterListState.Failed)?.message,
        )
    }

    private fun listState(state: FilterListState): String = when (state) {
        FilterListState.Ready -> "ready"
        FilterListState.Downloading -> "downloading"
        FilterListState.Compiling -> "compiling"
        is FilterListState.Failed -> "failed"
        FilterListState.Offline -> "offline"
        FilterListState.TooLarge -> "tooLarge"
    }

    companion object {
        const val PREFERENCES = "ardia-blocking"
        private const val FOLDER = "Blocking"
        private const val KEY_ENABLED = "blocking.enabled"
    }
}

private class EnginePageFilter(
    private val filter: com.ardia.blocking.PageFilter,
    private val isOn: () -> Boolean,
) : PageFilter {
    override fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean): Boolean =
        isOn() && filter.blocks(requestUrl, pageUrl, isMainFrame)

    override fun scriptsAtDocumentStart(pageUrl: String): List<String> = if (isOn()) filter.scriptsAtDocumentStart(pageUrl) else emptyList()

    override fun scriptsAtDocumentEnd(pageUrl: String): List<String> = if (isOn()) filter.scriptsAtDocumentEnd(pageUrl) else emptyList()
}
