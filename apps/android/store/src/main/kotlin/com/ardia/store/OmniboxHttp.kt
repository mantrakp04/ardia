package com.ardia.store

import java.net.HttpURLConnection
import java.net.URL

data class HttpResult(val status: Int, val body: ByteArray, val etag: String?)

fun interface OmniboxHttp {
    fun get(url: String, headers: Map<String, String>, timeoutMillis: Int, maxBytes: Int): HttpResult?
}

class PrivateHttp : OmniboxHttp {
    override fun get(url: String, headers: Map<String, String>, timeoutMillis: Int, maxBytes: Int): HttpResult? {
        val connection = runCatching { URL(url).openConnection() as HttpURLConnection }.getOrNull() ?: return null
        return try {
            connection.useCaches = false
            connection.instanceFollowRedirects = true
            connection.connectTimeout = timeoutMillis
            connection.readTimeout = timeoutMillis
            headers.forEach(connection::setRequestProperty)
            val status = connection.responseCode
            val body = if (status == 200) connection.inputStream.use { it.readLimited(maxBytes) } else ByteArray(0)
            if (body == null) null else HttpResult(status, body, connection.getHeaderField("ETag"))
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun java.io.InputStream.readLimited(maxBytes: Int): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val read = read(buffer)
            if (read < 0) return out.toByteArray()
            if (out.size() + read > maxBytes) return null
            out.write(buffer, 0, read)
        }
    }
}
