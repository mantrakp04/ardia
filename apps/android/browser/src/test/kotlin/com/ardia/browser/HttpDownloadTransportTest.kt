package com.ardia.browser

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class HttpDownloadTransportTest {
    private class Server(private val respond: (String) -> String?) : AutoCloseable {
        private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val requests: MutableList<String> = Collections.synchronizedList(ArrayList())
        val url: String get() = "http://127.0.0.1:${socket.localPort}"

        init {
            thread(isDaemon = true) {
                while (!socket.isClosed) {
                    val client = runCatching { socket.accept() }.getOrNull() ?: break
                    thread(isDaemon = true) { runCatching { serve(client) } }
                }
            }
        }

        private fun serve(client: java.net.Socket) = client.use {
            val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.ISO_8859_1))
            val line = reader.readLine() ?: return@use
            while (reader.readLine()?.isNotEmpty() == true) Unit
            requests += line
            val answer = respond(line) ?: return@use
            client.getOutputStream().apply {
                write(answer.toByteArray(Charsets.ISO_8859_1))
                flush()
            }
        }

        override fun close() {
            runCatching { socket.close() }
        }
    }

    private val servers = mutableListOf<Server>()
    private val transport = HttpDownloadTransport(timeoutMillis = 10_000)

    @After
    fun tearDown() = servers.forEach { it.close() }

    private fun server(respond: (String) -> String?) = Server(respond).also { servers += it }

    private fun fetchInBackground(url: String, cookies: (String) -> String?, call: DownloadCall): Pair<Thread, AtomicReference<Result<Pair<String, DownloadResponse>>>> {
        val result = AtomicReference<Result<Pair<String, DownloadResponse>>>()
        val worker = thread { result.set(runCatching { DownloadRules.fetch(url, "Agent", null, cookies, { true }, transport, call) }) }
        return worker to result
    }

    @Test
    fun aCancelWhileHeadersArePreparedSendsNoRequestAtAll() {
        val served = server { "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok" }
        val inLookup = CountDownLatch(1)
        val release = CountDownLatch(1)
        val call = DownloadCall()
        val cookies: (String) -> String? = {
            inLookup.countDown()
            release.await(5, TimeUnit.SECONDS)
            "session=secret"
        }
        val (worker, result) = fetchInBackground("${served.url}/file", cookies, call)
        assertTrue(inLookup.await(5, TimeUnit.SECONDS))
        call.cancel()
        release.countDown()
        worker.join(5_000)
        assertFalse(worker.isAlive)
        assertTrue("${result.get()}", result.get().exceptionOrNull() is DownloadCancelled)
        Thread.sleep(300)
        assertTrue("${served.requests}", served.requests.isEmpty())
    }

    @Test
    fun aCancelWhileTheServerHoldsTheResponseDisconnectsPromptly() {
        val received = CountDownLatch(1)
        val held = CountDownLatch(1)
        val served = server {
            received.countDown()
            held.await(10, TimeUnit.SECONDS)
            "HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        }
        val call = DownloadCall()
        val (worker, result) = fetchInBackground("${served.url}/held", { null }, call)
        assertTrue(received.await(5, TimeUnit.SECONDS))
        val cancelledAt = System.nanoTime()
        call.cancel()
        worker.join(5_000)
        assertFalse(worker.isAlive)
        assertTrue(System.nanoTime() - cancelledAt < TimeUnit.SECONDS.toNanos(2))
        assertTrue("${result.get()}", result.get().exceptionOrNull() is DownloadCancelled)
        held.countDown()
        Thread.sleep(300)
        assertEquals(listOf("GET /held HTTP/1.1"), served.requests.toList())
    }

    @Test
    fun theTransportFollowsNothingItselfAndKeepsNoCookies() {
        val served = server { line ->
            if (line.contains("/first")) {
                "HTTP/1.1 302 Found\r\nLocation: /second\r\nSet-Cookie: kept=1; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            } else {
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
            }
        }
        val response = transport.open("${served.url}/first", emptyMap(), DownloadCall())
        response.close()
        assertEquals(302, response.status)
        assertEquals("/second", response.header("location"))
        assertEquals(listOf("GET /first HTTP/1.1"), served.requests.toList())
    }

    @Test
    fun aCallCancelledBeforeRegistrationRefusesToStart() {
        val call = DownloadCall()
        call.cancel()
        try {
            call.register { fail("a cancelled call must not register an abort") }
            fail("registration after cancel must refuse")
        } catch (error: DownloadCancelled) {
            assertTrue(call.isCancelled)
        }
    }

    @Test
    fun aCancelAfterRegistrationRunsTheAbort() {
        val call = DownloadCall()
        val aborts = AtomicInteger()
        call.register { aborts.incrementAndGet() }
        call.cancel()
        assertTrue(aborts.get() >= 1)
    }
}
