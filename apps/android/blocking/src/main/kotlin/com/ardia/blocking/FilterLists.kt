package com.ardia.blocking

import java.io.File
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Locale
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

sealed class FilterListState {
    data object Ready : FilterListState()

    data object Downloading : FilterListState()

    data object Compiling : FilterListState()

    data class Failed(val message: String) : FilterListState()

    data object Offline : FilterListState()

    data object TooLarge : FilterListState()
}

data class FilterListInfo(
    val id: String,
    val title: String,
    val group: FilterListGroup,
    val category: BlockingCategory,
    val sourceUrl: String?,
    val supportUrl: String?,
    val languages: List<String>,
    val isEnabled: Boolean,
    val isDefault: Boolean,
    val isCustom: Boolean,
    val ruleCount: Int,
    val skippedCount: Int,
    val updatedAt: Long?,
    val state: FilterListState,
)

data class MyFiltersResult(val ruleCount: Int, val skippedCount: Int, val isTooLarge: Boolean = false)

data class FilterListsState(
    val lists: List<FilterListInfo> = emptyList(),
    val isUpdating: Boolean = false,
    val isOffline: Boolean = false,
    val lastUpdated: Long? = null,
    val myFilters: String = "",
    val myFiltersResult: MyFiltersResult = MyFiltersResult(0, 0),
    val buildError: String? = null,
) {
    val enabledLists: List<FilterListInfo> get() = lists.filter { it.isEnabled }
    val customListCount: Int get() = lists.count { it.isCustom }
    val enabledRuleCount: Int get() = enabledLists.sumOf { it.ruleCount } + myFiltersResult.ruleCount

    fun list(id: String): FilterListInfo? = lists.firstOrNull { it.id == id }
}

sealed class FilterListError(val message: String) {
    data object InvalidAddress : FilterListError("Enter an address that starts with https://.")

    data object AlreadyAdded : FilterListError("This list is already in your lists.")

    class Unreachable(reason: String) : FilterListError(reason)

    data object TooLarge : FilterListError("This list is too large for Ardia to use.")

    data object NotAFilterList : FilterListError("This doesn’t look like a filter list. Check the address and try again.")
}

class FilterListException(val error: FilterListError) : Exception(error.message)

@Serializable
internal data class CustomFilterList(val id: String, val url: String, val title: String)

@Serializable
internal data class FilterListRecord(
    val etag: String? = null,
    val lastModified: String? = null,
    val downloadedAt: Long? = null,
    val ruleCount: Int = 0,
    val skipped: Int = 0,
)

@Serializable
internal data class FilterBuildRecord(
    val lists: Map<String, FilterListRecord> = emptyMap(),
    val builtAt: Long? = null,
    val signature: String? = null,
)

class CompiledFilters internal constructor(val sources: List<EngineSource>, val revision: Long)

class FilterLists(
    val directory: File,
    private val store: BlockingStore,
    private val downloader: FilterListDownloader,
    private val languages: List<String> = listOf(Locale.getDefault().toLanguageTag()),
    private val isMobile: Boolean = true,
    val catalog: FilterListCatalog = FilterListCatalog.bundled,
    private val clock: () -> Long = System::currentTimeMillis,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val workDispatcher: CoroutineDispatcher = Dispatchers.Default,
    val budget: ListBudget = ListBudget(),
) {
    private val serial = Dispatchers.Default.limitedParallelism(1)
    private var selection: MutableSet<String>
    private var custom: MutableList<CustomFilterList>
    private var myFilters: String
    private var myFiltersResult = MyFiltersResult(0, 0)
    private var record: FilterBuildRecord
    private val states = HashMap<String, FilterListState>()
    private var isUpdating = false
    private var isOffline = false
    private var lastUpdated: Long?
    private var buildError: String? = null
    private var building: Deferred<Unit>? = null
    private var needsBuild = false
    private var revision = 0L
    private val loaded = HashMap<String, ParsedFilterList>()

    var isDemo = false
        private set

    private val mutableState = MutableStateFlow(FilterListsState())
    private val mutableCompiled = MutableStateFlow<CompiledFilters?>(null)

    val state: StateFlow<FilterListsState> = mutableState.asStateFlow()
    val compiled: StateFlow<CompiledFilters?> = mutableCompiled.asStateFlow()

    var lastBuildStats = BuildStats(0, 0, 0)
        private set

    data class BuildStats(val reused: Int, val parsed: Int, val millis: Long)

    init {
        val saved = store.strings(KEY_SELECTION)
        selection = if (saved != null) {
            saved.toMutableSet()
        } else {
            catalog.defaultSelection(languages, isMobile).toMutableSet().also { store.setStrings(KEY_SELECTION, it.sorted()) }
        }
        custom = store.string(KEY_CUSTOM)?.let { text ->
            runCatching { blockingJson.decodeFromString(ListSerializer(CustomFilterList.serializer()), text) }.getOrNull()
        }.orEmpty().toMutableList()
        myFilters = store.string(KEY_MINE).orEmpty()
        record = runCatching { blockingJson.decodeFromString(FilterBuildRecord.serializer(), recordFile.readText()) }.getOrNull() ?: FilterBuildRecord()
        lastUpdated = record.lists.values.mapNotNull { it.downloadedAt }.maxOrNull()
        publish()
    }

    val recordFile: File get() = File(directory, "filters.json")

    fun sourceFile(id: String): File = File(File(directory, "Lists"), "$id.txt")

    internal fun compiledFile(id: String): File = File(File(directory, "Compiled"), "$id.bin")

    fun list(id: String): FilterListInfo? = mutableState.value.list(id)

    fun setEnabled(id: String, enabled: Boolean): Job = scope.launch(serial) {
        val changed = if (enabled) selection.add(id) else selection.remove(id)
        if (!changed) return@launch
        store.setStrings(KEY_SELECTION, selection.sorted())
        publish()
        if (enabled && record.lists[id]?.downloadedAt == null) download(listOf(id), allowExpensive = true, force = false)
        rebuildOnSerial()
    }

    suspend fun updateNow() = withContext(serial) {
        download(enabledIds(), allowExpensive = true, force = true)
        rebuildOnSerial()
    }

    suspend fun updateIfNeeded(now: Long = clock()) = withContext(serial) {
        val due = ArrayList<String>()
        val urgent = ArrayList<String>()
        for (id in enabledIds()) {
            val downloaded = record.lists[id]?.downloadedAt
            if (downloaded == null) {
                urgent += id
                continue
            }
            val interval = updateAfterDays(id) * DAY_MILLIS
            val age = now - downloaded
            if (age >= 2 * interval || age < 0) urgent += id else if (age >= interval) due += id
        }
        val changedUrgent = download(urgent, allowExpensive = true, force = false)
        val changedDue = download(due, allowExpensive = false, force = false)
        if (changedUrgent || changedDue || (loaded.isEmpty() && enabledIds().isNotEmpty())) rebuildOnSerial()
    }

    suspend fun addList(url: String): String? = try {
        addCustomList(url)
        null
    } catch (error: FilterListException) {
        error.error.message
    }

    suspend fun addCustomList(url: String): FilterListInfo = withContext(serial) {
        val parsedUrl = runCatching { URI(url.trim()) }.getOrNull()
        val host = parsedUrl?.host
        if (parsedUrl == null || parsedUrl.scheme?.lowercase() != "https" || host.isNullOrEmpty()) throw FilterListException(FilterListError.InvalidAddress)
        val address = parsedUrl.toString()
        val known = catalog.lists.flatMap { it.urls }.toSet() + custom.map { it.url }
        if (address in known) throw FilterListException(FilterListError.AlreadyAdded)
        val id = "custom-" + hash(address).take(12)
        if (isDemo) {
            custom += CustomFilterList(id, address, host)
            selection += id
            record = record.copy(lists = record.lists + (id to FilterListRecord(downloadedAt = clock(), ruleCount = 1240, skipped = 12)))
            publish()
            return@withContext list(id) ?: mutableState.value.lists.last()
        }
        val fetched = try {
            fetch(address, null, allowExpensive = true) ?: throw FilterListException(FilterListError.NotAFilterList)
        } catch (error: FilterListException) {
            throw error
        } catch (error: Exception) {
            throw FilterListException(FilterListError.Unreachable(DownloadMessages.forError(error)))
        }
        val parsed = withContext(workDispatcher) {
            try {
                FilterParser.parse(fetched.text, id, budget.maxRulesPerList, budget.maxCharsPerList)
            } catch (error: FilterListTooLargeException) {
                null
            } catch (error: OutOfMemoryError) {
                null
            }
        } ?: throw FilterListException(FilterListError.TooLarge)
        if (parsed.convertedLines == 0) throw FilterListException(FilterListError.NotAFilterList)
        val title = title(fetched.text) ?: host
        runCatching { writeText(sourceFile(id), fetched.text) }
        record = record.copy(
            lists = record.lists + (
                id to FilterListRecord(fetched.etag, fetched.lastModified, clock(), ruleCount = 0, skipped = parsed.skippedLines)
                ),
        )
        custom += CustomFilterList(id, address, title)
        selection += id
        saveCustom()
        store.setStrings(KEY_SELECTION, selection.sorted())
        saveRecord()
        publish()
        rebuildOnSerial()
        list(id) ?: mutableState.value.lists.last()
    }

    fun removeList(id: String): Job = scope.launch(serial) {
        if (custom.none { it.id == id }) return@launch
        custom.removeAll { it.id == id }
        selection.remove(id)
        record = record.copy(lists = record.lists - id)
        sourceFile(id).delete()
        compiledFile(id).delete()
        loaded.remove(id)
        saveCustom()
        store.setStrings(KEY_SELECTION, selection.sorted())
        saveRecord()
        publish()
        rebuildOnSerial()
    }

    suspend fun applyMyFilters(text: String): MyFiltersResult = withContext(serial) {
        myFilters = text
        store.setString(KEY_MINE, text)
        val parsed = withContext(workDispatcher) { parseMine(text) }
        myFiltersResult = parsed?.let { MyFiltersResult(it.convertedLines, it.skippedLines) } ?: MyFiltersResult(0, 0, isTooLarge = true)
        publish()
        rebuildOnSerial()
        myFiltersResult
    }

    suspend fun resetToDefaults() = withContext(serial) {
        selection = catalog.defaultSelection(languages, isMobile).toMutableSet()
        for (list in custom) {
            sourceFile(list.id).delete()
            compiledFile(list.id).delete()
            loaded.remove(list.id)
        }
        custom = mutableListOf()
        saveCustom()
        store.setStrings(KEY_SELECTION, selection.sorted())
        publish()
        download(enabledIds().filter { record.lists[it]?.downloadedAt == null }, allowExpensive = true, force = false)
        rebuildOnSerial()
    }

    suspend fun loadCompiled() = withContext(serial) {
        if (isDemo) return@withContext
        val ids = enabledIds().filter { sourceFile(it).isFile }
        val mine = myFilters
        val previous = HashMap(loaded)
        val started = System.nanoTime()
        val output = withContext(workDispatcher) { compile(ids, mine, previous) }
        lastBuildStats = BuildStats(output.reused, output.parsed, (System.nanoTime() - started) / 1_000_000)
        replaceLoaded(ids, output)
        myFiltersResult = output.mine?.let { MyFiltersResult(it.convertedLines, it.skippedLines) } ?: MyFiltersResult(0, 0, output.mineTooLarge)
        for (id in output.tooLarge) states[id] = FilterListState.TooLarge
        publishCompiled(ids, output.mine)
        publish()
    }

    suspend fun rebuild() = withContext(serial) { rebuildOnSerial() }

    fun seedDemo(states: Map<String, FilterListState>): Job? {
        if (!isDemo) return null
        return scope.launch(serial) {
            this@FilterLists.states.clear()
            this@FilterLists.states.putAll(states)
            isOffline = states.values.contains(FilterListState.Offline)
            isUpdating = states.values.any { it == FilterListState.Downloading || it == FilterListState.Compiling }
            publish()
        }
    }

    private suspend fun rebuildOnSerial() {
        building?.let {
            needsBuild = true
            it.await()
            return
        }
        val task = scope.async(serial) {
            try {
                do {
                    needsBuild = false
                    build()
                } while (needsBuild)
            } finally {
                building = null
            }
        }
        building = task
        task.await()
    }

    private suspend fun build() {
        if (isDemo) return
        val ids = enabledIds().filter { sourceFile(it).isFile }
        val signature = buildSignature(ids)
        if (signature == record.signature && (mutableCompiled.value != null || (ids.isEmpty() && myFilters.isEmpty()))) {
            lastBuildStats = BuildStats(ids.size, 0, 0)
            return
        }
        val downloadStates = HashMap(states)
        for (id in ids) if (states[id] == null) states[id] = FilterListState.Compiling
        publish()
        val started = System.nanoTime()
        val mine = myFilters
        val previous = HashMap(loaded)
        val output = withContext(workDispatcher) { compile(ids, mine, previous) }
        var counts = record.lists
        replaceLoaded(ids, output)
        for ((id, list) in output.lists) {
            val entry = counts[id] ?: FilterListRecord()
            counts = counts + (id to entry.copy(ruleCount = list.convertedLines, skipped = list.skippedLines))
        }
        myFiltersResult = output.mine?.let { MyFiltersResult(it.convertedLines, it.skippedLines) } ?: MyFiltersResult(0, 0, output.mineTooLarge)
        val complete = output.failed.isEmpty() && output.tooLarge.isEmpty() && !output.mineTooLarge
        record = record.copy(lists = counts, signature = if (complete) signature else null, builtAt = clock())
        saveRecord()
        for (id in ids) {
            states.remove(id)
            if (id in output.tooLarge) {
                states[id] = FilterListState.TooLarge
            } else if (id in output.failed) {
                states[id] = FilterListState.Failed("Ardia couldn’t use this list’s rules. It keeps the last version that worked.")
            } else {
                downloadStates[id]?.let { states[id] = it }
            }
        }
        buildError = when {
            output.tooLarge.isNotEmpty() -> "Some lists are too large for Ardia to use. Ardia keeps the last version that worked."
            output.failed.isNotEmpty() -> "Some lists couldn’t be applied. Ardia keeps the last version that worked."
            else -> null
        }
        lastBuildStats = BuildStats(output.reused, output.parsed, (System.nanoTime() - started) / 1_000_000)
        publishCompiled(ids, output.mine)
        publish()
    }

    private fun replaceLoaded(ids: List<String>, output: CompileOutput) {
        val included = output.lists.map { it.first }.toSet()
        for (id in ids) if (id !in included) loaded.remove(id)
        output.lists.forEach { (id, list) -> loaded[id] = list }
    }

    private fun publishCompiled(ids: List<String>, mine: ParsedFilterList?) {
        val sources = ArrayList<EngineSource>()
        for (id in ids) {
            val list = loaded[id] ?: continue
            sources += EngineSource(list, category(id))
        }
        if (mine != null) sources += EngineSource(mine, null, isOwner = true)
        revision++
        mutableCompiled.value = CompiledFilters(sources, revision)
    }

    private class CompileOutput(
        val lists: List<Pair<String, ParsedFilterList>>,
        val mine: ParsedFilterList?,
        val failed: Set<String>,
        val tooLarge: Set<String>,
        val mineTooLarge: Boolean,
        val reused: Int,
        val parsed: Int,
    )

    private fun compile(ids: List<String>, mine: String, previous: Map<String, ParsedFilterList>): CompileOutput {
        val lists = ArrayList<Pair<String, ParsedFilterList>>()
        val failed = HashSet<String>()
        val tooLarge = HashSet<String>()
        var reused = 0
        var parsedCount = 0
        var rules = 0
        var chars = 0L
        for (id in ids) {
            val limit = budget.copy(
                maxRulesPerList = minOf(budget.maxRulesPerList, budget.maxRulesTotal - rules),
                maxCharsPerList = minOf(budget.maxCharsPerList, budget.maxCharsTotal - chars),
            )
            val keepPrevious = { previous[id]?.takeIf { it.ruleUnits <= limit.maxRulesPerList && it.textChars <= limit.maxCharsPerList } }
            val source = sourceFile(id)
            val size = source.length()
            val modified = source.lastModified()
            var list = if (limit.maxRulesPerList > 0) CompiledListFile.read(compiledFile(id), size, modified, limit) else null
            if (list != null) {
                reused++
            } else {
                list = try {
                    if (limit.maxRulesPerList <= 0) throw FilterListTooLargeException(id)
                    val parsed = source.bufferedReader(Charsets.UTF_8).use { FilterParser.parse(it, id, limit.maxRulesPerList, limit.maxCharsPerList) }
                    parsedCount++
                    runCatching { CompiledListFile.write(compiledFile(id), parsed, size, modified) }
                    parsed
                } catch (error: FilterListTooLargeException) {
                    tooLarge += id
                    keepPrevious()
                } catch (error: OutOfMemoryError) {
                    tooLarge += id
                    keepPrevious()
                } catch (error: IOException) {
                    failed += id
                    keepPrevious()
                }
            }
            if (list != null) {
                lists += id to list
                rules += list.ruleUnits
                chars += list.textChars
            }
        }
        val owner = if (mine.isBlank()) null else parseMine(mine)
        return CompileOutput(lists, owner, failed, tooLarge, mineTooLarge = !mine.isBlank() && owner == null, reused, parsedCount)
    }

    private fun parseMine(text: String): ParsedFilterList? = try {
        FilterParser.parse(text, MY_FILTERS_ID, budget.maxRulesPerList, budget.maxCharsPerList)
    } catch (error: FilterListTooLargeException) {
        null
    } catch (error: OutOfMemoryError) {
        null
    }

    private class Fetched(val text: String, val etag: String?, val lastModified: String?)

    private suspend fun download(ids: List<String>, allowExpensive: Boolean, force: Boolean): Boolean {
        if (ids.isEmpty() || isDemo) return false
        isUpdating = true
        var changed = false
        var offline = false
        try {
            for (id in ids) {
                states[id] = FilterListState.Downloading
                publish()
                var outcome: FilterListState? = FilterListState.Failed(DownloadMessages.GENERIC)
                for (url in sourceUrls(id)) {
                    try {
                        val previous = if (force || !sourceFile(id).isFile) null else record.lists[id]
                        val fetched = fetch(url, previous, allowExpensive)
                        if (fetched == null) {
                            if (previous != null) {
                                record = record.copy(lists = record.lists + (id to previous.copy(downloadedAt = clock())))
                                outcome = null
                                break
                            }
                            continue
                        }
                        withContext(Dispatchers.IO) { writeText(sourceFile(id), fetched.text) }
                        val entry = record.lists[id] ?: FilterListRecord()
                        record = record.copy(
                            lists = record.lists + (id to entry.copy(etag = fetched.etag, lastModified = fetched.lastModified, downloadedAt = clock())),
                        )
                        changed = true
                        outcome = null
                        break
                    } catch (error: NetworkUnavailableException) {
                        offline = true
                        outcome = FilterListState.Offline
                        break
                    } catch (error: Exception) {
                        outcome = FilterListState.Failed(DownloadMessages.forError(error))
                    }
                }
                if (outcome == null) states.remove(id) else states[id] = outcome
            }
        } finally {
            isUpdating = false
        }
        isOffline = offline
        saveRecord()
        lastUpdated = record.lists.values.mapNotNull { it.downloadedAt }.maxOrNull()
        publish()
        return changed
    }

    private suspend fun fetch(url: String, previous: FilterListRecord?, allowExpensive: Boolean): Fetched? {
        val response = downloader.fetch(url, previous?.etag, previous?.lastModified, allowExpensive)
        if (response.status == 304) return null
        if (response.status !in 200..299) throw FilterListException(FilterListError.Unreachable(DownloadMessages.SERVER))
        if (response.body.size >= MAX_LIST_BYTES) throw FilterListException(FilterListError.NotAFilterList)
        val text = decode(response.body)
        if (!looksLikeFilterList(text)) throw FilterListException(FilterListError.NotAFilterList)
        return Fetched(text, response.etag, response.lastModified)
    }

    private fun buildSignature(ids: List<String>): String {
        val parts = mutableListOf("format=${CompiledListFile.FORMAT}", "mine=${hash(myFilters)}")
        for (id in ids) {
            val file = sourceFile(id)
            parts += "$id:${file.length()}:${file.lastModified()}"
        }
        return hash(parts.joinToString("|"))
    }

    private fun enabledIds(): List<String> =
        catalog.lists.map { it.id }.filter { it in selection } + custom.map { it.id }.filter { it in selection }

    private fun sourceUrls(id: String): List<String> =
        catalog.lists.firstOrNull { it.id == id }?.urls ?: custom.firstOrNull { it.id == id }?.let { listOf(it.url) }.orEmpty()

    private fun updateAfterDays(id: String): Long = (catalog.lists.firstOrNull { it.id == id }?.updateAfter ?: 5).toLong()

    internal fun category(id: String): BlockingCategory = catalog.lists.firstOrNull { it.id == id }?.category ?: BlockingCategory.ADS

    private fun publish() {
        val defaults = catalog.defaultSelection(languages, isMobile)
        val catalogLists = catalog.lists.map { entry ->
            val saved = record.lists[entry.id]
            FilterListInfo(
                id = entry.id,
                title = entry.title,
                group = FilterListGroup.fromCatalogGroup(if (entry.group2 == "cookies") "cookies" else entry.group),
                category = entry.category,
                sourceUrl = entry.urls.firstOrNull(),
                supportUrl = entry.supportURL,
                languages = entry.lang.orEmpty(),
                isEnabled = entry.id in selection,
                isDefault = entry.id in defaults,
                isCustom = false,
                ruleCount = saved?.ruleCount ?: 0,
                skippedCount = saved?.skipped ?: 0,
                updatedAt = saved?.downloadedAt,
                state = states[entry.id] ?: FilterListState.Ready,
            )
        }
        val customLists = custom.map { list ->
            val saved = record.lists[list.id]
            FilterListInfo(
                id = list.id,
                title = list.title,
                group = FilterListGroup.CUSTOM,
                category = BlockingCategory.ADS,
                sourceUrl = list.url,
                supportUrl = null,
                languages = emptyList(),
                isEnabled = list.id in selection,
                isDefault = false,
                isCustom = true,
                ruleCount = saved?.ruleCount ?: 0,
                skippedCount = saved?.skipped ?: 0,
                updatedAt = saved?.downloadedAt,
                state = states[list.id] ?: FilterListState.Ready,
            )
        }
        mutableState.value = FilterListsState(
            lists = catalogLists + customLists,
            isUpdating = isUpdating,
            isOffline = isOffline,
            lastUpdated = lastUpdated,
            myFilters = myFilters,
            myFiltersResult = myFiltersResult,
            buildError = buildError,
        )
    }

    private fun saveCustom() = store.setString(KEY_CUSTOM, blockingJson.encodeToString(ListSerializer(CustomFilterList.serializer()), custom))

    private fun saveRecord() {
        runCatching { writeText(recordFile, blockingJson.encodeToString(FilterBuildRecord.serializer(), record)) }
    }

    companion object {
        const val MY_FILTERS_ID = "my-filters"
        const val KEY_SELECTION = "filters.selection"
        const val KEY_CUSTOM = "filters.custom"
        const val KEY_MINE = "filters.myFilters"
        const val MAX_LIST_BYTES = 16_000_000
        private const val DAY_MILLIS = 86_400_000L

        private val offlineDownloader = object : FilterListDownloader {
            override suspend fun fetch(url: String, etag: String?, lastModified: String?, allowExpensive: Boolean): FetchResponse =
                throw NetworkUnavailableException()
        }

        fun demo(directory: File, store: BlockingStore, scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)): FilterLists {
            val now = System.currentTimeMillis()
            val lists = FilterLists(
                directory, store, offlineDownloader, languages = listOf("en-US"), isMobile = true, scope = scope,
            )
            lists.isDemo = true
            val counts = mapOf(
                "ublock-filters" to (9460 to 14490), "ublock-badware" to (4375 to 628), "ublock-privacy" to (1115 to 741),
                "ublock-unbreak" to (1954 to 617), "ublock-quick-fixes" to (239 to 265), "adguard-mobile" to (7015 to 927),
                "easylist" to (84792 to 1001), "easyprivacy" to (56280 to 103), "urlhaus-1" to (77295 to 0),
                "fanboy-cookiemonster" to (25393 to 2767), "plowe-0" to (3563 to 0),
            )
            val records = HashMap<String, FilterListRecord>()
            lists.catalog.lists.forEachIndexed { offset, entry ->
                val count = counts[entry.id] ?: ((2000 + (offset * 7919) % 30000) to ((offset * 131) % 900))
                records[entry.id] = FilterListRecord(downloadedAt = now - (3600 + offset * 1700) * 1000L, ruleCount = count.first, skipped = count.second)
            }
            lists.record = FilterBuildRecord(records)
            lists.lastUpdated = now - 3_600_000
            lists.publish()
            return lists
        }

        fun looksLikeFilterList(text: String): Boolean {
            val head = text.take(200_000)
            if (head.contains("[Adblock") || head.contains("! Title:")) return true
            if (head.contains("<html", ignoreCase = true) || head.contains("<!doctype", ignoreCase = true)) return false
            var rules = 0
            for (line in head.lineSequence()) {
                if (line.startsWith("||") || line.contains("##") || line.startsWith("@@") || line.startsWith("0.0.0.0 ") || line.startsWith("127.0.0.1 ")) rules++
                if (rules >= 3) break
            }
            return rules >= 1
        }

        fun title(text: String): String? {
            for (line in text.take(4000).lineSequence()) {
                if (line.startsWith("! Title:")) return line.removePrefix("! Title:").trim().ifEmpty { null }
            }
            return null
        }

        fun hash(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

        internal fun decode(bytes: ByteArray): String = try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        } catch (error: CharacterCodingException) {
            String(bytes, Charsets.ISO_8859_1)
        }

        internal fun writeText(file: File, text: String) {
            file.parentFile?.mkdirs()
            val temporary = File(file.parentFile, file.name + ".tmp")
            temporary.writeText(text, Charsets.UTF_8)
            if (!temporary.renameTo(file)) {
                file.delete()
                if (!temporary.renameTo(file)) throw IOException("could not save ${file.name}")
            }
        }
    }
}

object FilterListAddress {
    sealed class Validation {
        data class Valid(val address: String) : Validation()

        data class Invalid(val message: String) : Validation()

        val url: String? get() = (this as? Valid)?.address
    }

    fun validate(text: String): Validation {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return Validation.Invalid("Enter the list’s address.")
        val uri = runCatching { URI(trimmed) }.getOrNull()
        val scheme = uri?.scheme?.lowercase()
        val host = uri?.host
        if (uri == null || (scheme != "https" && scheme != "http") || host == null || !host.contains('.')) {
            return Validation.Invalid(FilterListError.InvalidAddress.message)
        }
        return Validation.Valid(trimmed)
    }
}
