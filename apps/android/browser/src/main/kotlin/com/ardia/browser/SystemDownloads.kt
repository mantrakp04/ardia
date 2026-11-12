package com.ardia.browser

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import java.net.HttpURLConnection
import java.net.URL
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

sealed interface DownloadOutcome {
    val fileName: String

    data class Finished(override val fileName: String, val uri: Uri?) : DownloadOutcome

    data class Failed(override val fileName: String, val reason: DownloadFailure = DownloadFailure.Network) : DownloadOutcome
}

data class DownloadProgress(val id: Long, val fileName: String, val bytes: Long, val total: Long?) {
    val fraction: Float? get() = total?.takeIf { it > 0 }?.let { (bytes.toDouble() / it).coerceIn(0.0, 1.0).toFloat() }
}

class SystemDownloads(
    context: Context,
    private val cookies: DownloadCookies = NORMAL_PAGE_COOKIES,
    private val transport: DownloadTransport = HttpDownloadTransport(),
) {
    constructor(context: Context, engine: PageEngine) : this(context, DownloadCookies(engine::cookieHeader))

    private val resolver: ContentResolver = context.applicationContext.contentResolver
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = ConcurrentHashMap<Long, Job>()
    private val nextId = AtomicLong()
    private val mutableActive = MutableStateFlow<List<DownloadProgress>>(emptyList())
    private val finished = Channel<DownloadOutcome>(capacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    val active: StateFlow<List<DownloadProgress>> = mutableActive.asStateFlow()

    val outcomes: Flow<DownloadOutcome> = finished.receiveAsFlow()

    fun enqueue(download: PageDownload): Long? {
        if (!BrowserUrl.isWeb(download.url)) return null
        val id = nextId.incrementAndGet()
        val requestedName = DownloadRules.safeFileName(download.fileName)
        report(DownloadProgress(id, requestedName, 0, download.contentLength.takeIf { it > 0 }))
        val job = scope.launch {
            val outcome = transfer(id, download, requestedName)
            jobs.remove(id)
            mutableActive.update { list -> list.filterNot { it.id == id } }
            if (outcome != null) finished.trySend(outcome)
        }
        jobs[id] = job
        job.invokeOnCompletion { jobs.remove(id) }
        return id
    }

    fun cancel(id: Long) {
        jobs.remove(id)?.cancel()
        mutableActive.update { list -> list.filterNot { it.id == id } }
    }

    private suspend fun transfer(id: Long, download: PageDownload, requestedName: String): DownloadOutcome? {
        var target: Uri? = null
        var name = requestedName
        try {
            val (_, response) = DownloadRules.fetch(download.url, download.isPrivate, download.userAgent, download.referer, cookies, transport)
            response.use {
                val served = response.header("content-type")?.substringBefore(';')?.trim()?.ifEmpty { null }
                val named = requestedName.substringAfterLast('.', "").lowercase().ifEmpty { null }
                    ?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
                val mimeType = named ?: served ?: download.mimeType
                val total = response.contentLength ?: download.contentLength.takeIf { it > 0 }
                val created = createEntry(requestedName, mimeType) ?: return DownloadOutcome.Failed(requestedName, DownloadFailure.Storage)
                target = created.first
                name = created.second
                val output = resolver.openOutputStream(created.first, "w") ?: run {
                    discard(created.first)
                    return DownloadOutcome.Failed(name, DownloadFailure.Storage)
                }
                output.use {
                    val buffer = ByteArray(BUFFER_SIZE)
                    var written = 0L
                    var lastReport = 0L
                    while (true) {
                        kotlinx.coroutines.currentCoroutineContext().ensureActive()
                        val read = response.body.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        written += read
                        val now = System.nanoTime()
                        if (now - lastReport > REPORT_INTERVAL_NANOS) {
                            lastReport = now
                            report(DownloadProgress(id, name, written, total))
                        }
                    }
                }
            }
            publish(target!!)
            return DownloadOutcome.Finished(name, target)
        } catch (error: DownloadRefused) {
            target?.let(::discard)
            return DownloadOutcome.Failed(name, error.failure)
        } catch (error: kotlinx.coroutines.CancellationException) {
            target?.let(::discard)
            throw error
        } catch (error: Exception) {
            target?.let(::discard)
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
        private const val BUFFER_SIZE = 64 * 1024
        private const val REPORT_INTERVAL_NANOS = 250_000_000L

        val NORMAL_PAGE_COOKIES = DownloadCookies { url, isPrivate ->
            if (isPrivate) null else runCatching { CookieManager.getInstance().getCookie(url) }.getOrNull()
        }
    }
}

class HttpDownloadTransport(private val timeoutMillis: Int = 30_000) : DownloadTransport {
    override fun open(url: String, headers: Map<String, String>): DownloadResponse {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.connectTimeout = timeoutMillis
        connection.readTimeout = timeoutMillis
        connection.setRequestProperty("Accept-Encoding", "identity")
        for ((name, value) in headers) connection.setRequestProperty(name, value)
        val status = connection.responseCode
        val body = if (status in 200..299) connection.inputStream else (connection.errorStream ?: java.io.ByteArrayInputStream(ByteArray(0)))
        val responseHeaders = connection.headerFields.filterKeys { it != null }
        return DownloadResponse(status, responseHeaders, body) { connection.disconnect() }
    }
}
