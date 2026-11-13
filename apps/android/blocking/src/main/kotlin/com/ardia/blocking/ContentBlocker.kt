package com.ardia.blocking

import java.io.File
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

sealed class ContentBlockerState {
    data object Preparing : ContentBlockerState()

    data class Ready(val updatedAt: Long?) : ContentBlockerState()

    data class Failed(val message: String) : ContentBlockerState()
}

class ContentBlocker(
    val settings: BlockingSettings,
    val filterLists: FilterLists,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val workDispatcher: CoroutineDispatcher = Dispatchers.Default,
) {
    private val seeds = SeedRules.sources()
    private val mutableState = MutableStateFlow<ContentBlockerState>(ContentBlockerState.Preparing)
    private val prepareLock = Mutex()
    private val installLock = Mutex()
    private var prepared = false
    private var installedRevision = -1L

    @Volatile
    var engine: FilterEngine = FilterEngine.build(seeds)
        private set

    val state: StateFlow<ContentBlockerState> = mutableState.asStateFlow()

    val isRefreshing: Boolean get() = filterLists.state.value.isUpdating

    val regexRulesSkippedForBudget: Long get() = ListRegex.rulesSkippedForBudget

    fun start(): Job = scope.launch { prepare() }

    suspend fun prepare() {
        prepareLock.withLock {
            if (prepared) return
            prepared = true
            val directory = filterLists.directory
            val ready = withContext(Dispatchers.IO) { directory.isDirectory || directory.mkdirs() }
            if (!ready) {
                mutableState.value = ContentBlockerState.Failed("Ardia couldn’t set up content blocking. Restart Ardia to try again.")
                return
            }
            scope.launch(workDispatcher) { PublicSuffixes.shared }
            filterLists.loadCompiled()
            syncEngine()
            scope.launch { filterLists.compiled.filterNotNull().collect { install(it) } }
            mutableState.value = ContentBlockerState.Ready(filterLists.state.value.lastUpdated)
        }
    }

    suspend fun refreshIfDue(now: Long = System.currentTimeMillis(), force: Boolean = false) {
        prepare()
        if (force) filterLists.updateNow() else filterLists.updateIfNeeded(now)
        syncEngine()
        if (mutableState.value is ContentBlockerState.Ready) mutableState.value = ContentBlockerState.Ready(filterLists.state.value.lastUpdated)
    }

    fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean): Boolean =
        blocks(requestUrl, pageUrl, isMainFrame, type = null, isPrivate = false)

    fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean, type: RequestType?, isPrivate: Boolean): Boolean {
        val context = RequestContext.current()
        if (!context.loadRequest(requestUrl)) return false
        context.loadPage(pageUrl, isMainFrame)
        val snapshot = settings.snapshot
        if (context.pageKnown && snapshot.isExempt(context.pageSuffixHashes, context.pageSuffixCount, isPrivate)) return false
        context.categoryMask = snapshot.categoryMask
        context.type = type ?: context.inferType(isMainFrame)
        return engine.blocks(context)
    }

    fun scriptsAtDocumentStart(pageUrl: String): List<String> = scriptsAtDocumentStart(pageUrl, isPrivate = false)

    fun scriptsAtDocumentStart(pageUrl: String, isPrivate: Boolean): List<String> {
        val context = pageContext(pageUrl, isPrivate) ?: return emptyList()
        val css = engine.hidingCss(context) ?: return emptyList()
        val scripts = ArrayList<String>(2)
        if (css.generic.isNotEmpty()) scripts += BlockingScripts.hiding(css.generic)
        if (css.specific.isNotEmpty()) scripts += BlockingScripts.hiding(css.specific)
        return scripts
    }

    fun scriptsAtDocumentEnd(pageUrl: String): List<String> = scriptsAtDocumentEnd(pageUrl, isPrivate = false)

    fun scriptsAtDocumentEnd(pageUrl: String, isPrivate: Boolean): List<String> {
        if (!settings.hidesCookieBanners) return emptyList()
        pageContext(pageUrl, isPrivate) ?: return emptyList()
        return listOf(BlockingScripts.consent)
    }

    fun blockersEnabled(pageUrl: String?, isPrivate: Boolean = false): Boolean = !settings.isExempt(hostOf(pageUrl), isPrivate)

    fun setBlockersEnabled(pageUrl: String?, enabled: Boolean, isPrivate: Boolean = false): String? {
        val host = hostOf(pageUrl) ?: return null
        settings.setExempt(host, !enabled, isPrivate)
        return if (enabled) "Blockers enabled for $host" else "Blockers disabled for $host"
    }

    fun pageFilter(isPrivate: Boolean = false, counter: BlockedResourceCounter? = null): PageFilter = PageFilter(this, isPrivate, counter)

    private fun pageContext(pageUrl: String, isPrivate: Boolean): RequestContext? {
        val host = hostOf(pageUrl) ?: return null
        val context = RequestContext.current()
        context.loadHost(host)
        if (!context.pageKnown) return null
        val snapshot = settings.snapshot
        if (snapshot.isExempt(context.pageSuffixHashes, context.pageSuffixCount, isPrivate)) return null
        context.categoryMask = snapshot.categoryMask
        return context
    }

    internal suspend fun syncEngine() {
        filterLists.compiled.value?.let { install(it) }
    }

    private suspend fun install(compiled: CompiledFilters) = installLock.withLock {
        val latest = filterLists.compiled.value?.takeIf { it.revision > compiled.revision } ?: compiled
        if (latest.revision <= installedRevision) return@withLock
        val next = withContext(workDispatcher) {
            try {
                FilterEngine.build(seeds + latest.sources)
            } catch (error: OutOfMemoryError) {
                null
            }
        }
        if (next != null) engine = next
        installedRevision = latest.revision
    }

    companion object {
        fun create(directory: File, store: BlockingStore, downloader: FilterListDownloader): ContentBlocker {
            val settings = BlockingSettings(store)
            val lists = FilterLists(File(directory, "Filters"), store, downloader)
            return ContentBlocker(settings, lists)
        }

        internal fun hostOf(url: String?): String? {
            if (url == null) return null
            val schemeEnd = url.indexOf("://")
            if (schemeEnd <= 0) return null
            val scheme = url.substring(0, schemeEnd).lowercase()
            if (scheme != "http" && scheme != "https") return null
            val start = schemeEnd + 3
            var end = start
            while (end < url.length && url[end] != '/' && url[end] != '?' && url[end] != '#') end++
            val authority = url.substring(start, end)
            val at = authority.lastIndexOf('@')
            var host = if (at >= 0) authority.substring(at + 1) else authority
            if (!host.startsWith("[")) {
                val colon = host.indexOf(':')
                if (colon >= 0) host = host.substring(0, colon)
            }
            host = host.lowercase().trimEnd('.')
            return host.ifEmpty { null }
        }
    }
}

class PageFilter internal constructor(
    private val blocker: ContentBlocker,
    private val isPrivate: Boolean,
    private val counter: BlockedResourceCounter?,
) {
    fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean): Boolean {
        val blocked = blocker.blocks(requestUrl, pageUrl, isMainFrame, type = null, isPrivate = isPrivate)
        if (blocked) counter?.add(1)
        return blocked
    }

    fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean, type: RequestType): Boolean {
        val blocked = blocker.blocks(requestUrl, pageUrl, isMainFrame, type = type, isPrivate = isPrivate)
        if (blocked) counter?.add(1)
        return blocked
    }

    fun scriptsAtDocumentStart(pageUrl: String): List<String> = blocker.scriptsAtDocumentStart(pageUrl, isPrivate)

    fun scriptsAtDocumentEnd(pageUrl: String): List<String> = blocker.scriptsAtDocumentEnd(pageUrl, isPrivate)
}
