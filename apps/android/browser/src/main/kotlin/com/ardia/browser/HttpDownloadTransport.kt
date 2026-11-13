package com.ardia.browser

import java.io.ByteArrayInputStream
import java.util.concurrent.TimeUnit
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request

class HttpDownloadTransport(timeoutMillis: Long = 30_000) : DownloadTransport {
    private val client = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .cookieJar(CookieJar.NO_COOKIES)
        .cache(null)
        .connectTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
        .readTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
        .build()

    override fun open(url: String, headers: Map<String, String>, call: DownloadCall): DownloadResponse {
        val request = Request.Builder().url(url).get().apply {
            for ((name, value) in headers) header(name, value)
            header("Accept-Encoding", "identity")
        }.build()
        val pending = client.newCall(request)
        call.register { pending.cancel() }
        val response = pending.execute()
        val body = response.body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))
        return DownloadResponse(response.code, response.headers.toMultimap(), body) { response.close() }
    }
}
