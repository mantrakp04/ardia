package com.ardia.browser

import java.io.ByteArrayInputStream
import java.io.IOException
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.Authenticator
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response

class HttpDownloadTransport(private val timeoutMillis: Long = 30_000) : DownloadTransport {
    private val normal: OkHttpClient by lazy { newClient() }
    private val scoped = ConcurrentHashMap<String, OkHttpClient>()
    private val endedScopes: MutableSet<String> = ConcurrentHashMap.newKeySet()

    override fun open(url: String, headers: Map<String, String>, call: DownloadCall): DownloadResponse {
        val client = clientFor(call.connectionScope)
        val request = Request.Builder().url(url).get().apply {
            for ((name, value) in headers) header(name, value)
            header("Accept-Encoding", "identity")
            header("Connection", "close")
            tag(NetworkAttempts::class.java, NetworkAttempts())
        }.build()
        val pending = client.newCall(request)
        call.register { pending.cancel() }
        val response = pending.execute()
        val body = response.body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))
        return DownloadResponse(response.code, response.headers.toMultimap(), body) { response.close() }
    }

    override fun endConnectionScope(scope: String) {
        endedScopes += scope
        scoped.remove(scope)?.let(::shutDown)
    }

    private fun clientFor(scope: String?): OkHttpClient {
        if (scope == null) return normal
        if (scope in endedScopes) throw DownloadRefused(DownloadFailure.PrivateSessionEnded)
        val client = scoped.computeIfAbsent(scope) { newClient() }
        if (scope in endedScopes) {
            scoped.remove(scope)?.let(::shutDown)
            throw DownloadRefused(DownloadFailure.PrivateSessionEnded)
        }
        return client
    }

    private fun newClient(): OkHttpClient {
        val trust = platformTrustManager()
        val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
        return OkHttpClient.Builder()
            .protocols(listOf(Protocol.HTTP_1_1))
            .connectionPool(ConnectionPool(0, 1, TimeUnit.MILLISECONDS))
            .sslSocketFactory(tls.socketFactory, trust)
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .authenticator(Authenticator.NONE)
            .proxyAuthenticator(Authenticator.NONE)
            .cookieJar(CookieJar.NO_COOKIES)
            .cache(null)
            .addNetworkInterceptor(OneNetworkAttempt)
            .connectTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
            .build()
    }

    private fun shutDown(client: OkHttpClient) {
        runCatching { client.dispatcher.cancelAll() }
        runCatching { client.connectionPool.evictAll() }
    }

    private class NetworkAttempts {
        val count = AtomicInteger()
    }

    private object OneNetworkAttempt : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val attempts = chain.request().tag(NetworkAttempts::class.java) ?: throw IOException("A download request carries its attempt count")
            if (attempts.count.incrementAndGet() > 1) throw IOException("A download request is sent once")
            val response = chain.proceed(chain.request())
            if (response.header("Retry-After") == null) return response
            return response.newBuilder().removeHeader("Retry-After").build()
        }
    }

    private companion object {
        fun platformTrustManager(): X509TrustManager {
            val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            factory.init(null as KeyStore?)
            return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
        }
    }
}
