package com.ardia.browser

import java.io.ByteArrayInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DownloadRulesTest {
    private class FakeTransport(private val routes: Map<String, Pair<Int, String?>>) : DownloadTransport {
        val sent = mutableListOf<Pair<String, Map<String, String>>>()
        var closed = 0

        override fun open(url: String, headers: Map<String, String>, call: DownloadCall): DownloadResponse {
            sent += url to headers
            val (status, location) = routes[url] ?: (404 to null)
            val responseHeaders = location?.let { mapOf("Location" to listOf(it)) } ?: mapOf("Content-Length" to listOf("4"))
            return DownloadResponse(status, responseHeaders, ByteArrayInputStream("data".toByteArray())) { closed += 1 }
        }
    }

    private val jar = DownloadCookies { url, isPrivate ->
        when {
            isPrivate -> "leaked=1"
            BrowserUrl.rawHost(url) == "bank.example" -> "session=secret"
            BrowserUrl.rawHost(url) == "cdn.example" -> "cdn=1"
            else -> null
        }
    }

    private class FakeSessions : DownloadSessions {
        var current: String? = "A"
        val cookieByHost = mutableMapOf("A" to "session=A", "B" to "session=B")
        val ended = mutableListOf<(String) -> Unit>()

        override fun privateCookieHeader(url: String, session: String): String? =
            if (session == current && BrowserUrl.rawHost(url) == "bank.example") cookieByHost[session] else null

        override fun isPrivateSessionLive(session: String): Boolean = session == current

        override fun addPrivateSessionEndListener(listener: (String) -> Unit): AutoCloseable {
            ended += listener
            return AutoCloseable { ended -= listener }
        }
    }

    private fun normal(url: String) = PageDownload(url, "a.pdf", null, -1, null, null, null, isPrivate = false)

    private fun fetch(url: String, transport: DownloadTransport, userAgent: String? = null, call: DownloadCall = DownloadCall()) =
        DownloadRules.fetch(url, userAgent, null, DownloadRules.cookiesFor(normal(url), jar, null), { true }, transport, call)

    private fun refused(block: () -> Unit): DownloadFailure {
        try {
            block()
        } catch (error: DownloadRefused) {
            return error.failure
        }
        fail("expected the download to be refused")
        throw AssertionError()
    }

    @Test
    fun eachHopCarriesOnlyItsOwnCookies() {
        val transport = FakeTransport(
            mapOf(
                "https://bank.example/statement" to (302 to "https://evil.example/collect"),
                "https://evil.example/collect" to (302 to "https://cdn.example/file.pdf"),
                "https://cdn.example/file.pdf" to (200 to null),
            ),
        )
        val (finalUrl, response) = fetch("https://bank.example/statement", transport, userAgent = "Agent")
        response.close()
        assertEquals("https://cdn.example/file.pdf", finalUrl)
        assertEquals(listOf("https://bank.example/statement", "https://evil.example/collect", "https://cdn.example/file.pdf"), transport.sent.map { it.first })
        assertEquals("session=secret", transport.sent[0].second["Cookie"])
        assertNull(transport.sent[1].second["Cookie"])
        assertEquals("cdn=1", transport.sent[2].second["Cookie"])
        assertTrue(transport.sent.all { it.second["User-Agent"] == "Agent" })
        assertEquals(3, transport.closed)
    }

    @Test
    fun aPrivateDownloadReadsOnlyItsOwnSessionsJar() {
        val sessions = FakeSessions()
        val download = PageDownload("https://bank.example/a", "a.pdf", null, -1, null, null, null, isPrivate = true, privateSession = "A")
        val transport = FakeTransport(
            mapOf(
                "https://bank.example/a" to (302 to "https://bank.example/b"),
                "https://bank.example/b" to (200 to null),
            ),
        )
        val cookies = DownloadRules.cookiesFor(download, jar, sessions)
        DownloadRules.fetch(download.url, null, null, cookies, DownloadRules.liveCheckFor(download, sessions), transport, DownloadCall()).second.close()
        assertEquals(listOf("session=A", "session=A"), transport.sent.map { it.second["Cookie"] })
    }

    @Test
    fun aRedirectHeldAcrossASessionChangeNeverReachesTheNextSession() {
        val sessions = FakeSessions()
        val download = PageDownload("https://bank.example/a", "a.pdf", null, -1, null, null, null, isPrivate = true, privateSession = "A")
        val sent = mutableListOf<Pair<String, String?>>()
        val transport = DownloadTransport { url, headers, _ ->
            sent += url to headers["Cookie"]
            sessions.current = "B"
            DownloadResponse(302, mapOf("Location" to listOf("https://bank.example/b")), ByteArrayInputStream(ByteArray(0)))
        }
        val cookies = DownloadRules.cookiesFor(download, jar, sessions)
        val failure = refused { DownloadRules.fetch(download.url, null, null, cookies, DownloadRules.liveCheckFor(download, sessions), transport, DownloadCall()) }
        assertEquals(DownloadFailure.PrivateSessionEnded, failure)
        assertEquals(listOf("https://bank.example/a" to "session=A"), sent)
        assertNull(cookies("https://bank.example/b"))
    }

    @Test
    fun privateDownloadsWithoutABoundSessionSendNoCookies() {
        val unbound = PageDownload("https://bank.example/a", "a.pdf", null, -1, null, null, null, isPrivate = true)
        assertNull(DownloadRules.cookiesFor(unbound, jar, FakeSessions())("https://bank.example/a"))
        val bound = unbound.copy(privateSession = "A")
        assertNull(DownloadRules.cookiesFor(bound, jar, null)("https://bank.example/a"))
        assertNull(DownloadRules.cookiesFor(bound, jar, FakeSessions().apply { current = "B" })("https://bank.example/a"))
    }

    @Test
    fun aCancelWhileTheResponseIsPendingStopsBeforeTheNextHop() {
        val opened = CountDownLatch(1)
        val aborted = CountDownLatch(1)
        val sent = mutableListOf<String>()
        val transport = DownloadTransport { url, _, call ->
            sent += url
            call.register { aborted.countDown() }
            opened.countDown()
            aborted.await(5, TimeUnit.SECONDS)
            DownloadResponse(302, mapOf("Location" to listOf("https://cdn.example/next")), ByteArrayInputStream(ByteArray(0)))
        }
        val call = DownloadCall()
        val outcome = java.util.concurrent.atomic.AtomicReference<Throwable?>()
        val worker = Thread {
            outcome.set(runCatching { fetch("https://bank.example/a", transport, call = call) }.exceptionOrNull())
        }
        worker.start()
        assertTrue(opened.await(5, TimeUnit.SECONDS))
        val cancelledAt = System.nanoTime()
        call.cancel()
        worker.join(5_000)
        assertFalse(worker.isAlive)
        assertTrue(System.nanoTime() - cancelledAt < TimeUnit.SECONDS.toNanos(2))
        assertTrue(outcome.get() is DownloadCancelled)
        assertEquals(listOf("https://bank.example/a"), sent)
    }

    @Test
    fun aCancelBeforeTheFirstHopOpensNothing() {
        val transport = FakeTransport(mapOf("https://bank.example/a" to (200 to null)))
        val call = DownloadCall().apply { cancel() }
        try {
            fetch("https://bank.example/a", transport, call = call)
            fail("a cancelled call must not open a connection")
        } catch (error: DownloadCancelled) {
            assertTrue(transport.sent.isEmpty())
        }
    }

    private class EndlessStream : java.io.InputStream() {
        override fun read(): Int = 7

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            java.util.Arrays.fill(buffer, offset, offset + length, 7)
            return length
        }
    }

    private class CountingOutput : java.io.OutputStream() {
        var count = 0L

        override fun write(byte: Int) {
            count += 1
        }

        override fun write(buffer: ByteArray, offset: Int, length: Int) {
            count += length
        }
    }

    @Test
    fun aBodyThatNeverEndsStopsWhenSpaceRunsLow() {
        val output = CountingOutput()
        val reserve = 8L * 1024 * 1024
        val free = 20L * 1024 * 1024
        val failure = refused {
            DownloadRules.copy(EndlessStream(), output, null, DownloadCall(), { true }, { free - output.count }, reserve)
        }
        assertEquals(DownloadFailure.NoSpace, failure)
        assertTrue("${output.count}", output.count in 1L..(free - reserve + DownloadRules.SPACE_CHECK_BYTES))
    }

    @Test
    fun aKnownSizeLargerThanTheFreeSpaceFailsBeforeReading() {
        val output = CountingOutput()
        val failure = refused {
            DownloadRules.copy(EndlessStream(), output, 50L * 1024 * 1024, DownloadCall(), { true }, { 40L * 1024 * 1024 }, 1024)
        }
        assertEquals(DownloadFailure.NoSpace, failure)
        assertEquals(0L, output.count)
    }

    @Test
    fun copyingStopsForACancelOrAnEndedSession() {
        val call = DownloadCall()
        val output = CountingOutput()
        try {
            DownloadRules.copy(EndlessStream(), output, null, call, { true }, { Long.MAX_VALUE }, 0) { written -> if (written > 1_000_000) call.cancel() }
            fail("a cancelled copy must stop")
        } catch (error: DownloadCancelled) {
            assertTrue(output.count < 2_000_000)
        }
        var live = true
        val failure = refused {
            DownloadRules.copy(EndlessStream(), CountingOutput(), null, DownloadCall(), { live }, { Long.MAX_VALUE }, 0) { written -> if (written > 1_000_000) live = false }
        }
        assertEquals(DownloadFailure.PrivateSessionEnded, failure)
    }

    @Test
    fun aBigDownloadWithRoomIsNotLimited() {
        val output = CountingOutput()
        val body = object : java.io.InputStream() {
            var left = 64L * 1024 * 1024

            override fun read(): Int = if (left-- > 0) 1 else -1

            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (left <= 0) return -1
                val count = minOf(length.toLong(), left).toInt()
                left -= count
                return count
            }
        }
        val written = DownloadRules.copy(body, output, 64L * 1024 * 1024, DownloadCall(), { true }, { 10L * 1024 * 1024 * 1024 })
        assertEquals(64L * 1024 * 1024, written)
    }

    @Test
    fun aRedirectFromHttpsToHttpIsRefused() {
        val transport = FakeTransport(mapOf("https://bank.example/a" to (302 to "http://bank.example/a")))
        assertEquals(DownloadFailure.InsecureRedirect, refused { fetch("https://bank.example/a", transport) })
        assertEquals(1, transport.sent.size)
    }

    @Test
    fun plainHttpMayUpgradeToHttps() {
        val transport = FakeTransport(
            mapOf(
                "http://files.example/a" to (301 to "https://files.example/a"),
                "https://files.example/a" to (200 to null),
            ),
        )
        assertEquals("https://files.example/a", fetch("http://files.example/a", transport).first)
    }

    @Test
    fun relativeLocationsResolveAgainstTheHop() {
        val transport = FakeTransport(
            mapOf(
                "https://files.example/dir/a" to (307 to "../b?x=1#frag"),
                "https://files.example/b?x=1" to (200 to null),
            ),
        )
        assertEquals("https://files.example/b?x=1", fetch("https://files.example/dir/a", transport).first)
    }

    @Test
    fun redirectsToOtherSchemesOrNowhereAreRefused() {
        val toFile = FakeTransport(mapOf("https://a.example/x" to (302 to "file:///data/data/x")))
        assertEquals(DownloadFailure.Unsupported, refused { fetch("https://a.example/x", toFile) })
        val noLocation = FakeTransport(mapOf("https://a.example/x" to (302 to null)))
        assertEquals(DownloadFailure.Server, refused { fetch("https://a.example/x", noLocation) })
        assertEquals(DownloadFailure.Unsupported, refused { fetch("blob:https://a.example/1", noLocation) })
        assertEquals(DownloadFailure.Unsupported, refused { fetch("data:text/plain,hi", noLocation) })
    }

    @Test
    fun endlessRedirectsStop() {
        val loop = FakeTransport(mapOf("https://a.example/x" to (302 to "https://a.example/x")))
        assertEquals(DownloadFailure.TooManyRedirects, refused { fetch("https://a.example/x", loop) })
        assertEquals(DownloadRules.MAX_REDIRECTS + 1, loop.sent.size)
    }

    @Test
    fun serverErrorsFail() {
        val missing = FakeTransport(emptyMap())
        assertEquals(DownloadFailure.Server, refused { fetch("https://a.example/x", missing) })
        val broken = DownloadTransport { _, _, _ -> throw java.io.IOException("reset") }
        assertEquals(DownloadFailure.Network, refused { fetch("https://a.example/x", broken) })
    }

    @Test
    fun refererFollowsStrictOriginWhenCrossOrigin() {
        assertEquals("https://a.example/page?q=1", DownloadRules.referer("https://a.example/page?q=1#top", "https://a.example/file"))
        assertEquals("https://a.example/", DownloadRules.referer("https://a.example/page?q=1", "https://b.example/file"))
        assertNull(DownloadRules.referer("https://a.example/page", "http://a.example/file"))
        assertEquals("http://a.example/", DownloadRules.referer("http://a.example/page", "https://b.example/file"))
        assertNull(DownloadRules.referer(null, "https://b.example/file"))
        assertNull(DownloadRules.referer("ardia://start", "https://b.example/file"))
    }

    @Test
    fun fileNamesCannotEscapeTheDownloadsFolder() {
        assertEquals("report.pdf", DownloadRules.safeFileName("report.pdf"))
        assertEquals("passwd", DownloadRules.safeFileName("../../etc/passwd"))
        assertEquals("evil.exe", DownloadRules.safeFileName("..\\..\\evil.exe"))
        assertEquals("ab.txt", DownloadRules.safeFileName("a\u0000b.txt"))
        assertEquals("hidden", DownloadRules.safeFileName(".hidden"))
        assertEquals("Download", DownloadRules.safeFileName(".."))
        assertEquals("Download", DownloadRules.safeFileName("   "))
        assertEquals("Download", DownloadRules.safeFileName(null))
        assertEquals("notes.txt", DownloadRules.safeFileName("notes.txt..."))
        assertEquals("ab", DownloadRules.safeFileName("a:*?\"<>|b"))
    }

    @Test
    fun longNamesKeepTheirExtension() {
        val long = DownloadRules.safeFileName("x".repeat(300) + ".pdf")
        assertTrue(long.length <= 120)
        assertTrue(long.endsWith(".pdf"))
        assertEquals(120, DownloadRules.safeFileName("y".repeat(300)).length)
    }

    @Test
    fun collidingNamesGetANumber() {
        assertEquals("a.pdf", DownloadRules.uniqueName("a.pdf", setOf("b.pdf")))
        assertEquals("a 2.pdf", DownloadRules.uniqueName("a.pdf", setOf("a.pdf")))
        assertEquals("a 3.pdf", DownloadRules.uniqueName("a.pdf", setOf("A.PDF", "a 2.pdf")))
        assertEquals("README 2", DownloadRules.uniqueName("README", setOf("README")))
        assertFalse(DownloadRules.uniqueName("a.pdf", setOf("a.pdf")).contains('/'))
    }
}
