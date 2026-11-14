package com.ardia.blocking

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class FetchResponse(
    val status: Int,
    val body: ByteArray,
    val etag: String? = null,
    val lastModified: String? = null,
)

class NetworkUnavailableException(message: String = "network unavailable") : IOException(message)

class ResponseTooLargeException : IOException("response too large")

interface FilterListDownloader {
    suspend fun fetch(url: String, etag: String?, lastModified: String?, allowExpensive: Boolean): FetchResponse
}

interface NetworkStatus {
    val isOnline: Boolean
    val isExpensive: Boolean

    companion object {
        val alwaysOnline: NetworkStatus = object : NetworkStatus {
            override val isOnline = true
            override val isExpensive = false
        }
    }
}

class HttpFilterListDownloader(
    private val network: NetworkStatus = NetworkStatus.alwaysOnline,
    private val timeoutMillis: Int = 60_000,
) : FilterListDownloader {
    override suspend fun fetch(url: String, etag: String?, lastModified: String?, allowExpensive: Boolean): FetchResponse =
        withContext(Dispatchers.IO) {
            if (!network.isOnline || (!allowExpensive && network.isExpensive)) throw NetworkUnavailableException()
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = timeoutMillis
                connection.readTimeout = timeoutMillis
                connection.useCaches = false
                connection.instanceFollowRedirects = true
                etag?.let { connection.setRequestProperty("If-None-Match", it) }
                lastModified?.let { connection.setRequestProperty("If-Modified-Since", it) }
                val status = try {
                    connection.responseCode
                } catch (error: IOException) {
                    if (!network.isOnline) throw NetworkUnavailableException()
                    throw error
                }
                val body = if (status in 200..299) {
                    connection.inputStream.use { input ->
                        val out = ByteArrayOutputStream()
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            if (out.size() >= FilterLists.MAX_LIST_BYTES) throw ResponseTooLargeException()
                        }
                        out.toByteArray()
                    }
                } else {
                    ByteArray(0)
                }
                FetchResponse(status, body, connection.getHeaderField("ETag"), connection.getHeaderField("Last-Modified"))
            } finally {
                connection.disconnect()
            }
        }
}

internal object DownloadMessages {
    const val NOT_CONNECTED = "Your phone isn’t connected to the internet."
    const val TIMED_OUT = "The server took too long to respond. Ardia will try again later."
    const val NOT_FOUND = "The server can’t be found. Check the address and try again."
    const val GENERIC = "This list couldn’t be downloaded. Ardia will try again later."
    const val SERVER = "The server couldn’t provide this list right now. Ardia will try again later."

    fun forError(error: Throwable): String = when (error) {
        is FilterListException -> error.error.message
        is NetworkUnavailableException -> NOT_CONNECTED
        is SocketTimeoutException -> TIMED_OUT
        is UnknownHostException -> NOT_FOUND
        else -> GENERIC
    }
}
