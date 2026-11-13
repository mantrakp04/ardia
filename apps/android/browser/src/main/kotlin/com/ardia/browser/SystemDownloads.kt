package com.ardia.browser

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

sealed interface DownloadOutcome {
    val fileName: String

    data class Finished(override val fileName: String, val uri: Uri?) : DownloadOutcome

    data class Failed(override val fileName: String, val reason: DownloadFailure = DownloadFailure.Network) : DownloadOutcome
}

data class DownloadProgress(val id: Long, val fileName: String, val bytes: Long, val total: Long?, val isQueued: Boolean = false) {
    val fraction: Float? get() = total?.takeIf { it > 0 }?.let { (bytes.toDouble() / it).coerceIn(0.0, 1.0).toFloat() }
}

class SystemDownloads(
    context: Context,
    private val cookies: DownloadCookies = NORMAL_PAGE_COOKIES,
    private val transport: DownloadTransport = HttpDownloadTransport(),
    private val sessions: DownloadSessions? = null,
    maxRunning: Int = MAX_RUNNING,
    freeSpace: (() -> Long)? = null,
) {
    constructor(context: Context, engine: () -> PageEngine?) : this(
        context,
        DownloadCookies { url, isPrivate -> if (isPrivate) null else engine()?.cookieHeader(url, false) },
        sessions = EngineSessions(engine),
    )

    constructor(context: Context, engine: PageEngine) : this(context, { engine })

    private val resolver: ContentResolver = context.applicationContext.contentResolver
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = Semaphore(maxRunning.coerceAtLeast(1))
    private val entries = ConcurrentHashMap<Long, Entry>()
    private val nextId = AtomicLong()
    private val mutableActive = MutableStateFlow<List<DownloadProgress>>(emptyList())
    private val finished = Channel<DownloadOutcome>(capacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val downloadsFolderSpace: () -> Long = freeSpace ?: {
        (context.applicationContext.getExternalFilesDir(null) ?: Environment.getDataDirectory()).usableSpace
    }

    private class Entry(val download: PageDownload, val call: DownloadCall) {
        @Volatile
        var job: Job? = null

        @Volatile
        var endedWithSession = false

        @Volatile
        var started = false

        val announced = java.util.concurrent.atomic.AtomicBoolean()
    }

    private fun announce(entry: Entry, outcome: DownloadOutcome) {
        if (entry.announced.compareAndSet(false, true)) finished.trySend(outcome)
    }

    @Volatile
    private var sessionListener: AutoCloseable? = null
    private val sessionLock = Any()

    val active: StateFlow<List<DownloadProgress>> = mutableActive.asStateFlow()

    val outcomes: Flow<DownloadOutcome> = finished.receiveAsFlow()

    fun enqueue(download: PageDownload): Long? {
        if (!BrowserUrl.isWeb(download.url)) return null
        listenForSessionEnds()
        val id = nextId.incrementAndGet()
        val requestedName = DownloadRules.safeFileName(download.fileName)
        val connectionScope = when {
            !download.isPrivate -> null
            download.privateSession != null -> download.privateSession
            else -> "$UNBOUND_PRIVATE_SCOPE$id"
        }
        val entry = synchronized(sessionLock) {
            if (!DownloadRules.liveCheckFor(download, sessions)()) return null
            Entry(download, transport.newCall(connectionScope)).also { entries[id] = it }
        }
        report(DownloadProgress(id, requestedName, 0, download.contentLength.takeIf { it > 0 }, isQueued = true))
        val job = scope.launch {
            val outcome = try {
                running.withPermit {
                    entry.started = true
                    entry.call.ensureActive()
                    report(DownloadProgress(id, requestedName, 0, download.contentLength.takeIf { it > 0 }))
                    transfer(id, entry, requestedName)
                }
            } catch (error: DownloadCancelled) {
                if (entry.endedWithSession) DownloadOutcome.Failed(requestedName, DownloadFailure.PrivateSessionEnded) else null
            } finally {
                entries.remove(id)
                mutableActive.update { list -> list.filterNot { it.id == id } }
                if (connectionScope != null && connectionScope.startsWith(UNBOUND_PRIVATE_SCOPE)) transport.endConnectionScope(connectionScope)
            }
            if (outcome != null) announce(entry, outcome)
        }
        entry.job = job
        return id
    }

    fun cancel(id: Long) {
        val entry = entries[id] ?: return
        stop(entry)
        mutableActive.update { list -> list.filterNot { it.id == id } }
    }

    private fun stop(entry: Entry) {
        entry.call.cancel()
        if (!entry.started) entry.job?.cancel()
    }

    private fun listenForSessionEnds() {
        if (sessionListener != null) return
        val bound = sessions ?: return
        synchronized(this) {
            if (sessionListener == null) sessionListener = bound.addPrivateSessionEndListener(::endSession)
        }
    }

    private fun endSession(session: String) = synchronized(sessionLock) {
        transport.endConnectionScope(session)
        for (entry in entries.values) {
            if (entry.download.isPrivate && entry.download.privateSession == session) {
                entry.endedWithSession = true
                entry.call.cancel()
                if (!entry.started) {
                    entry.job?.cancel()
                    announce(entry, DownloadOutcome.Failed(DownloadRules.safeFileName(entry.download.fileName), DownloadFailure.PrivateSessionEnded))
                }
            }
        }
    }

    private fun transfer(id: Long, entry: Entry, requestedName: String): DownloadOutcome {
        val download = entry.download
        val call = entry.call
        val isLive = DownloadRules.liveCheckFor(download, sessions)
        var target: Uri? = null
        var name = requestedName
        try {
            val (_, response) = DownloadRules.fetch(download.url, download.userAgent, download.referer, DownloadRules.cookiesFor(download, cookies, sessions), isLive, transport, call)
            response.use {
                val served = response.header("content-type")?.substringBefore(';')?.trim()?.ifEmpty { null }
                val named = requestedName.substringAfterLast('.', "").lowercase().ifEmpty { null }
                    ?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
                val mimeType = named ?: served ?: download.mimeType
                val total = response.contentLength ?: download.contentLength.takeIf { it > 0 }
                if (total != null && downloadsFolderSpace() - total < DownloadRules.SPACE_RESERVE_BYTES) {
                    return DownloadOutcome.Failed(requestedName, DownloadFailure.NoSpace)
                }
                val created = createEntry(requestedName, mimeType) ?: return DownloadOutcome.Failed(requestedName, DownloadFailure.Storage)
                target = created.first
                name = created.second
                val output = resolver.openOutputStream(created.first, "w") ?: run {
                    discard(created.first)
                    return DownloadOutcome.Failed(name, DownloadFailure.Storage)
                }
                var lastReport = 0L
                output.use {
                    DownloadRules.copy(response.body, output, total, call, isLive, downloadsFolderSpace) { written ->
                        val now = System.nanoTime()
                        if (now - lastReport > REPORT_INTERVAL_NANOS) {
                            lastReport = now
                            report(DownloadProgress(id, name, written, total))
                        }
                    }
                }
            }
            call.ensureActive()
            if (!isLive()) throw DownloadRefused(DownloadFailure.PrivateSessionEnded)
            publish(target!!)
            return DownloadOutcome.Finished(name, target)
        } catch (error: DownloadRefused) {
            target?.let(::discard)
            return DownloadOutcome.Failed(name, error.failure)
        } catch (error: DownloadCancelled) {
            target?.let(::discard)
            throw error
        } catch (error: Exception) {
            target?.let(::discard)
            if (call.isCancelled) throw DownloadCancelled()
            return DownloadOutcome.Failed(name, if (target == null) DownloadFailure.Network else DownloadFailure.Storage)
        }
    }

    private fun report(progress: DownloadProgress) {
        mutableActive.update { list -> list.filterNot { it.id == progress.id } + progress }
    }

    private fun createEntry(requestedName: String, mimeType: String?): Pair<Uri, String>? {
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val name = DownloadRules.uniqueName(requestedName, visibleNames(collection, requestedName))
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
            mimeType?.let { put(MediaStore.MediaColumns.MIME_TYPE, it) }
        }
        val uri = runCatching { resolver.insert(collection, values) }.getOrNull() ?: return null
        val stored = runCatching {
            resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }.getOrNull()
        return uri to (stored ?: name)
    }

    private fun visibleNames(collection: Uri, requestedName: String): Set<String> {
        val base = requestedName.substringBeforeLast('.')
        return runCatching {
            resolver.query(
                collection,
                arrayOf(MediaStore.MediaColumns.DISPLAY_NAME),
                "${MediaStore.MediaColumns.RELATIVE_PATH} = ? AND ${MediaStore.MediaColumns.DISPLAY_NAME} LIKE ?",
                arrayOf(Environment.DIRECTORY_DOWNLOADS + "/", "$base%"),
                null,
            )?.use { cursor ->
                buildSet { while (cursor.moveToNext()) cursor.getString(0)?.let(::add) }
            }
        }.getOrNull().orEmpty()
    }

    private fun publish(uri: Uri) {
        val values = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
        resolver.update(uri, values, null, null)
    }

    private fun discard(uri: Uri) {
        runCatching { resolver.delete(uri, null, null) }
    }

    companion object {
        const val MAX_RUNNING = 3
        private const val UNBOUND_PRIVATE_SCOPE = "unbound-private-"
        private const val REPORT_INTERVAL_NANOS = 250_000_000L

        val NORMAL_PAGE_COOKIES = DownloadCookies { url, isPrivate ->
            if (isPrivate) null else runCatching { CookieManager.getInstance().getCookie(url) }.getOrNull()
        }
    }
}

private class EngineSessions(private val engine: () -> PageEngine?) : DownloadSessions {
    override fun privateCookieHeader(url: String, session: String): String? = engine()?.privateCookieHeader(url, session)

    override fun isPrivateSessionLive(session: String): Boolean = engine()?.isPrivateSessionLive(session) ?: false

    override fun addPrivateSessionEndListener(listener: (String) -> Unit): AutoCloseable? = engine()?.addPrivateSessionEndListener(listener)
}
