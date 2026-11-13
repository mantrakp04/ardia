package com.ardia.browser

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DownloadConnectionsTest {
    private class KeepAliveServer(private val answer: (path: String) -> String) : AutoCloseable {
        private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val accepted = AtomicInteger()
        val requests: MutableList<Pair<Int, String>> = Collections.synchronizedList(ArrayList())
        @Volatile
        var beforeAnswer: () -> Unit = {}
        val url: String get() = "http://127.0.0.1:${socket.localPort}"

        init {
            thread(isDaemon = true) {
                while (!socket.isClosed) {
                    val client = runCatching { socket.accept() }.getOrNull() ?: break
                    val connection = accepted.incrementAndGet()
                    thread(isDaemon = true) { runCatching { serve(client, connection) } }
                }
            }
        }

        private fun serve(client: Socket, connection: Int) = client.use {
            val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.ISO_8859_1))
            while (true) {
                val line = reader.readLine() ?: return@use
                while (reader.readLine()?.isNotEmpty() == true) Unit
                val path = line.split(' ').getOrElse(1) { "/" }
                requests += connection to path
                beforeAnswer()
                client.getOutputStream().apply {
                    write(answer(path).toByteArray(Charsets.ISO_8859_1))
                    flush()
                }
            }
        }

        fun requestsTo(path: String): Int = synchronized(requests) { requests.count { it.second == path } }

        override fun close() {
            runCatching { socket.close() }
        }
    }

    private val servers = mutableListOf<KeepAliveServer>()
    private val transport = HttpDownloadTransport(timeoutMillis = 10_000)

    @After
    fun tearDown() = servers.forEach { it.close() }

    private fun server(answer: (String) -> String) = KeepAliveServer(answer).also { servers += it }

    private val ok = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"

    private fun get(server: KeepAliveServer, path: String, scope: String?): Int {
        val response = transport.open(server.url + path, emptyMap(), DownloadCall(scope))
        response.body.readBytes()
        response.close()
        return response.status
    }

    @Test
    fun aNormalAndAPrivateDownloadNeverShareAConnection() {
        val served = server { ok }
        get(served, "/normal", null)
        get(served, "/private", "session-a")
        assertEquals(2, served.accepted.get())
        assertEquals(listOf(1 to "/normal", 2 to "/private"), served.requests.toList())
    }

    @Test
    fun twoPrivateSessionsNeverShareAConnection() {
        val served = server { ok }
        get(served, "/a", "session-a")
        get(served, "/b", "session-b")
        assertEquals(2, served.accepted.get())
    }

    @Test
    fun noConnectionIsKeptForReuseEvenWithinOneSession() {
        val served = server { ok }
        get(served, "/one", "session-a")
        get(served, "/two", "session-a")
        get(served, "/three", null)
        get(served, "/four", null)
        assertEquals(4, served.accepted.get())
        assertTrue(served.requests.map { it.first }.distinct().size == 4)
    }

    @Test
    fun twoDownloadsAtOnceToOneHostUseTwoConnections() {
        val served = server { ok }
        val bothArrived = CountDownLatch(2)
        served.beforeAnswer = {
            bothArrived.countDown()
            bothArrived.await(5, TimeUnit.SECONDS)
        }
        val statuses = Collections.synchronizedList(ArrayList<Int>())
        val workers = listOf("/first", "/second").map { path -> thread { statuses += get(served, path, "session-a") } }
        workers.forEach { it.join(10_000) }
        assertEquals(listOf(200, 200), statuses.toList())
        assertEquals(2, served.accepted.get())
        assertEquals(2, served.requests.map { it.first }.distinct().size)
    }

    @Test
    fun anEndedSessionCannotOpenAConnection() {
        val served = server { ok }
        get(served, "/before", "session-a")
        transport.endConnectionScope("session-a")
        try {
            get(served, "/after", "session-a")
            fail("an ended session must not open a connection")
        } catch (error: DownloadRefused) {
            assertEquals(DownloadFailure.PrivateSessionEnded, error.failure)
        }
        assertEquals(0, served.requestsTo("/after"))
        assertEquals(200, get(served, "/other", "session-b"))
    }

    @Test
    fun unavailableWithRetryAfterZeroIsSentOnce() {
        val served = server { "HTTP/1.1 503 Service Unavailable\r\nRetry-After: 0\r\nContent-Length: 0\r\n\r\n" }
        assertEquals(503, get(served, "/busy", null))
        assertEquals(1, served.requestsTo("/busy"))
    }

    @Test
    fun aRequestTimeoutIsSentOnce() {
        val served = server { "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\n\r\n" }
        assertEquals(408, get(served, "/slow", null))
        assertEquals(1, served.requestsTo("/slow"))
    }

    @Test
    fun aMisdirectedRequestIsSentOnce() {
        val served = server { "HTTP/1.1 421 Misdirected Request\r\nContent-Length: 0\r\n\r\n" }
        assertEquals(421, get(served, "/elsewhere", "session-a"))
        assertEquals(1, served.requestsTo("/elsewhere"))
    }

    @Test
    fun anAuthenticationChallengeIsSentOnce() {
        val served = server { "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"x\"\r\nContent-Length: 0\r\n\r\n" }
        assertEquals(401, get(served, "/locked", null))
        assertEquals(1, served.requestsTo("/locked"))
    }

    @Test
    fun aProxyChallengeIsSentOnce() {
        val served = server { "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"x\"\r\nContent-Length: 0\r\n\r\n" }
        runCatching { get(served, "/proxied", null) }
        assertEquals(1, served.requestsTo("/proxied"))
    }

    @Test
    fun redirectsAreLeftToTheCaller() {
        val served = server { "HTTP/1.1 307 Temporary Redirect\r\nLocation: /next\r\nContent-Length: 0\r\n\r\n" }
        assertEquals(307, get(served, "/moved", null))
        assertEquals(1, served.requestsTo("/moved"))
        assertEquals(0, served.requestsTo("/next"))
    }
}
