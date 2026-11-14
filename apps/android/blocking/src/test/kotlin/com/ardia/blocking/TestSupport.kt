package com.ardia.blocking

import java.io.File
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

internal const val ALL_CATEGORIES_MASK = 1 or 2 or 4 or BlockingSettings.OWNER_BIT

internal fun resource(name: String): String =
    requireNotNull(TestSupport::class.java.getResourceAsStream("/com/ardia/blocking/$name")) { "missing $name" }
        .bufferedReader().use { it.readText() }

internal fun engineOf(vararg lists: Pair<String, BlockingCategory?>, mine: String? = null): FilterEngine {
    val sources = lists.mapIndexed { index, (text, category) -> EngineSource(FilterParser.parse(text, "list$index"), category) }.toMutableList()
    if (mine != null) sources += EngineSource(FilterParser.parse(mine, FilterLists.MY_FILTERS_ID), null, isOwner = true)
    return FilterEngine.build(sources)
}

internal fun engineOf(text: String, category: BlockingCategory = BlockingCategory.ADS): FilterEngine = engineOf(text to category)

internal fun FilterEngine.blocks(
    url: String,
    page: String? = null,
    mainFrame: Boolean = false,
    type: RequestType? = null,
    mask: Int = ALL_CATEGORIES_MASK,
): Boolean {
    val context = RequestContext.current()
    if (!context.loadRequest(url)) return false
    context.loadPage(page, mainFrame)
    context.categoryMask = mask
    context.type = type ?: context.inferType(mainFrame)
    return blocks(context)
}

internal fun FilterEngine.hiding(host: String, mask: Int = ALL_CATEGORIES_MASK): FilterEngine.HidingCss? {
    val context = RequestContext.current()
    context.loadHost(host)
    context.categoryMask = mask
    return hidingCss(context)
}

internal fun FilterEngine.HidingCss.selectors(): Set<String> =
    (generic + specific).lines().filter { it.isNotBlank() }.flatMap { it.removeSuffix("{display:none!important}").split(',') }.toSet()

internal class TestSupport

internal class TempDirectory : AutoCloseable {
    val file: File = Files.createTempDirectory("ardia-blocking").toFile()

    override fun close() {
        file.deleteRecursively()
    }
}

internal class FakeClock(var now: Long = 1_800_000_000_000L) {
    fun advanceDays(days: Double) {
        now += (days * 86_400_000).toLong()
    }
}

internal class FakeDownloader : FilterListDownloader {
    class Reply(val status: Int, val body: String, val etag: String? = null)

    private val replies = HashMap<String, Reply>()
    val requests = mutableListOf<Request>()
    val calls = AtomicInteger()
    var online = true
    var expensive = false

    data class Request(val url: String, val etag: String?, val allowExpensive: Boolean)

    fun serve(url: String, body: String, status: Int = 200, etag: String? = null) {
        synchronized(replies) { replies[url] = Reply(status, body, etag) }
    }

    override suspend fun fetch(url: String, etag: String?, lastModified: String?, allowExpensive: Boolean): FetchResponse {
        calls.incrementAndGet()
        synchronized(requests) { requests += Request(url, etag, allowExpensive) }
        if (!online || (expensive && !allowExpensive)) throw NetworkUnavailableException()
        val reply = synchronized(replies) { replies[url] } ?: throw java.net.UnknownHostException(url)
        if (reply.etag != null && reply.etag == etag) return FetchResponse(304, ByteArray(0), reply.etag)
        return FetchResponse(reply.status, reply.body.toByteArray(), reply.etag)
    }
}

internal class Fixture(val catalog: FilterListCatalog = FilterListCatalog("test", emptyList())) : AutoCloseable {
    val directory = TempDirectory()
    val store = InMemoryBlockingStore()
    val downloader = FakeDownloader()
    val clock = FakeClock()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun lists(store: BlockingStore = this.store): FilterLists =
        FilterLists(directory.file, store, downloader, listOf("en-US"), isMobile = true, catalog = catalog, clock = { clock.now }, scope = scope)

    override fun close() {
        scope.cancel()
        directory.close()
    }

    companion object {
        fun entry(id: String, off: Boolean = false, group: String = "ads", group2: String? = null, updateAfter: Int = 5) =
            FilterListCatalog.Entry(id = id, title = id, group = group, group2 = group2, off = off, updateAfter = updateAfter, urls = listOf("https://lists.test/$id.txt"))
    }
}
