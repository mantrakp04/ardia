package com.ardia.store

import java.io.File
import java.util.concurrent.Executors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

class Omnibox(
    private val scriptFactory: () -> CoreScript,
    private val http: OmniboxHttp = PrivateHttp(),
    directory: File? = null,
    scriptDispatcher: CoroutineDispatcher? = null,
    private val workDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val clock: StoreClock = StoreClock.system,
) : AutoCloseable {
    private val ownedThread = if (scriptDispatcher == null) Executors.newSingleThreadExecutor { Thread(it, "ArdiaOmnibox") }.asCoroutineDispatcher() else null
    private val scriptDispatcher: CoroutineDispatcher = scriptDispatcher ?: ownedThread!!
    private val closeLock = Any()
    private var loadedScript: CoreScript? = null

    @Volatile var isClosed: Boolean = false
        private set
    private val bangsFile = directory?.let { File(it, "bangs.txt") }
    private var bangEtag: String? = null
    private var bangsLoaded = false
    private var bangsCheckedAt: Long? = null

    @Volatile private var lastSources: String? = null

    @Volatile var hasHistory: Boolean = false
        private set

    suspend fun warmUp() {
        call("mobileWarmBangs")
    }

    suspend fun setCandidates(candidates: OmniboxCandidates): Boolean {
        val json = withContext(workDispatcher) { encode(OmniboxCandidates.serializer(), candidates) }
        if (json == lastSources) return false
        val sent = call("mobileSetSources", json) != null
        if (sent) {
            lastSources = json
            hasHistory = candidates.history.isNotEmpty()
        }
        return sent
    }

    suspend fun setSearch(choice: SearchChoice?, localEngineId: String): SearchEngineInfo? {
        val input = SearchInput(choice?.engineId ?: localEngineId, choice?.customUrl, choice?.customEngines.orEmpty())
        val output = call("mobileSetSearch", encode(SearchInput.serializer(), input)) ?: return null
        return decode(SearchEngineInfo.serializer(), output)
    }

    suspend fun engines(): List<SearchEngineInfo> {
        val output = call("mobileEngines") ?: return emptyList()
        return decode(ListSerializer(SearchEngineInfo.serializer()), output).orEmpty()
    }

    suspend fun suggest(text: String, context: OmniboxContext = OmniboxContext(), remote: List<String> = emptyList(), now: Long = clock.now()): OmniboxResult {
        val options = SuggestOptions(
            currentUrl = context.currentUrl,
            currentTabId = context.currentTabId,
            remote = remote,
            preference = if (context.prefersSearch) "search" else "website",
            preventInline = context.preventInline,
            now = now.toDouble(),
        )
        val output = call("mobileSuggest", encode(String.serializer(), text), encode(SuggestOptions.serializer(), options))
        val raw = output?.let { decode(RawSuggestionResult.serializer(), it) } ?: return OmniboxResult(text, emptyList(), "")
        return raw.result(text)
    }

    suspend fun resolve(text: String): OmniboxResolution? {
        val output = call("mobileResolve", encode(String.serializer(), text)) ?: return null
        val raw = decode(RawResolution.serializer().nullable, output) ?: return null
        val kind = when (raw.kind) {
            "url" -> OmniboxResolution.Kind.URL
            "search" -> OmniboxResolution.Kind.SEARCH
            "bang" -> OmniboxResolution.Kind.BANG
            else -> return null
        }
        return OmniboxResolution(kind, raw.url, raw.query, raw.engine)
    }

    suspend fun remoteSuggestions(text: String): List<String> {
        val output = call("mobileSuggestRequest", encode(String.serializer(), text)) ?: return emptyList()
        val address = decode(String.serializer().nullable, output) ?: return emptyList()
        val response = withContext(workDispatcher) {
            http.get(address, mapOf("Accept" to "application/json"), SUGGESTION_TIMEOUT_MILLIS, SUGGESTION_MAX_BYTES)
        }
        currentCoroutineContext().ensureActive()
        if (response == null || response.status != 200) return emptyList()
        val parsed = call("mobileParseRemote", encode(String.serializer(), response.body.toString(Charsets.UTF_8))) ?: return emptyList()
        return decode(ListSerializer(String.serializer()), parsed).orEmpty()
    }

    suspend fun cleanUrl(url: String): String {
        val output = call("mobileClean", encode(String.serializer(), url)) ?: return url
        return decode(String.serializer(), output) ?: url
    }

    suspend fun display(url: String, title: String = ""): DisplayUrl {
        val output = call("mobileDisplay", encode(String.serializer(), url), encode(String.serializer(), title))
        return output?.let { decode(DisplayUrl.serializer(), it) } ?: DisplayUrl(url, url, emptyList())
    }

    suspend fun loadBangs() {
        if (bangsLoaded) return
        bangsLoaded = true
        val file = bangsFile
        val document = file?.let { withContext(workDispatcher) { runCatching { it.readText() }.getOrNull() } }
        val etag = document?.let { call("mobileLoadBangDocument", encode(String.serializer(), it)) }?.let { decode(String.serializer().nullable, it) }
        if (file == null || etag == null) {
            call("mobileWarmBangs")
            return
        }
        bangEtag = etag.ifEmpty { null }
        bangsCheckedAt = withContext(workDispatcher) { file.lastModified() }.takeIf { it > 0 }
    }

    suspend fun refreshBangsIfDue(now: Long = clock.now()) {
        loadBangs()
        bangsCheckedAt?.let { checked -> if (now >= checked && now - checked < BANG_REFRESH_MILLIS) return }
        bangsCheckedAt = now
        val headers = bangEtag?.let { mapOf("If-None-Match" to it) }.orEmpty()
        val response = withContext(workDispatcher) { http.get(BANG_LIST_URL, headers, BANG_TIMEOUT_MILLIS, BANG_MAX_BYTES) } ?: return
        if (response.status == 304) {
            bangsFile?.let { withContext(workDispatcher) { it.setLastModified(now) } }
            return
        }
        if (response.status != 200) return
        val output = call(
            "mobileBangDocument",
            encode(String.serializer(), response.body.toString(Charsets.UTF_8)),
            encode(String.serializer().nullable, response.etag),
        ) ?: return
        val document = decode(String.serializer().nullable, output) ?: return
        bangEtag = response.etag
        bangsFile?.let { file ->
            withContext(workDispatcher) {
                runCatching {
                    file.parentFile?.mkdirs()
                    val temporary = File(file.parentFile, ".bangs-${System.nanoTime()}.txt")
                    temporary.writeText(document)
                    if (!temporary.renameTo(file)) temporary.delete()
                }
            }
        }
    }

    override fun close() {
        synchronized(closeLock) {
            if (isClosed) return
            isClosed = true
        }
        runBlocking(scriptDispatcher) {
            runCatching { (loadedScript as? AutoCloseable)?.close() }
            loadedScript = null
        }
        ownedThread?.close()
    }

    private suspend fun call(function: String, vararg arguments: String): String? {
        if (isClosed) return null
        return try {
            withContext(scriptDispatcher) {
                if (isClosed) return@withContext null
                runCatching {
                    val script = loadedScript ?: scriptFactory().also { loadedScript = it }
                    script.call(function, arguments.toList())
                }.getOrNull()
            }
        } catch (error: CancellationException) {
            if (isClosed) null else throw error
        }
    }

    @Serializable
    private data class SearchInput(val engineId: String, val customUrl: String?, val customEngines: List<CustomSearchEngine>)

    @Serializable
    private data class SuggestOptions(
        val currentUrl: String?,
        val currentTabId: String?,
        val remote: List<String>,
        val preference: String,
        val preventInline: Boolean,
        val now: Double,
    )

    companion object {
        const val BANG_LIST_URL = "https://services.helium.imput.net/bangs.json"
        const val BANG_REFRESH_MILLIS = 7L * 24 * 3_600_000
        const val SUGGESTION_TIMEOUT_MILLIS = 4_000
        const val SUGGESTION_MAX_BYTES = 1_000_000
        const val BANG_TIMEOUT_MILLIS = 60_000
        const val BANG_MAX_BYTES = 8_000_000

        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

        internal fun <T> encode(serializer: KSerializer<T>, value: T): String = json.encodeToString(serializer, value)

        internal fun <T> decode(serializer: KSerializer<T>, text: String): T? = runCatching { json.decodeFromString(serializer, text) }.getOrNull()
    }
}
