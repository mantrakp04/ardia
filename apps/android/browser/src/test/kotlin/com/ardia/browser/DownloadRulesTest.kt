package com.ardia.browser

import java.io.ByteArrayInputStream
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

        override fun open(url: String, headers: Map<String, String>): DownloadResponse {
            sent += url to headers
            val (status, location) = routes[url] ?: (404 to null)
            val responseHeaders = location?.let { mapOf("Location" to listOf(it)) } ?: mapOf("Content-Length" to listOf("4"))
            return DownloadResponse(status, responseHeaders, ByteArrayInputStream("data".toByteArray())) { closed += 1 }
        }
    }

    private val jar = DownloadCookies { url, isPrivate ->
        when {
            isPrivate && BrowserUrl.rawHost(url) == "bank.example" -> "private=1"
            isPrivate -> null
            BrowserUrl.rawHost(url) == "bank.example" -> "session=secret"
            BrowserUrl.rawHost(url) == "cdn.example" -> "cdn=1"
            else -> null
        }
    }

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
        val (finalUrl, response) = DownloadRules.fetch("https://bank.example/statement", false, "Agent", null, jar, transport)
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
    fun privateDownloadsUseOnlyThePrivateJar() {
        val transport = FakeTransport(
            mapOf(
                "https://bank.example/a" to (302 to "https://cdn.example/a"),
                "https://cdn.example/a" to (200 to null),
            ),
        )
        DownloadRules.fetch("https://bank.example/a", true, null, null, jar, transport).second.close()
        assertEquals("private=1", transport.sent[0].second["Cookie"])
        assertNull(transport.sent[1].second["Cookie"])
    }

    @Test
    fun aRedirectFromHttpsToHttpIsRefused() {
        val transport = FakeTransport(mapOf("https://bank.example/a" to (302 to "http://bank.example/a")))
        assertEquals(DownloadFailure.InsecureRedirect, refused { DownloadRules.fetch("https://bank.example/a", false, null, null, jar, transport) })
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
        assertEquals("https://files.example/a", DownloadRules.fetch("http://files.example/a", false, null, null, jar, transport).first)
    }

    @Test
    fun relativeLocationsResolveAgainstTheHop() {
        val transport = FakeTransport(
            mapOf(
                "https://files.example/dir/a" to (307 to "../b?x=1#frag"),
                "https://files.example/b?x=1" to (200 to null),
            ),
        )
        assertEquals("https://files.example/b?x=1", DownloadRules.fetch("https://files.example/dir/a", false, null, null, jar, transport).first)
    }

    @Test
    fun redirectsToOtherSchemesOrNowhereAreRefused() {
        val toFile = FakeTransport(mapOf("https://a.example/x" to (302 to "file:///data/data/x")))
        assertEquals(DownloadFailure.Unsupported, refused { DownloadRules.fetch("https://a.example/x", false, null, null, jar, toFile) })
        val noLocation = FakeTransport(mapOf("https://a.example/x" to (302 to null)))
        assertEquals(DownloadFailure.Server, refused { DownloadRules.fetch("https://a.example/x", false, null, null, jar, noLocation) })
        assertEquals(DownloadFailure.Unsupported, refused { DownloadRules.fetch("blob:https://a.example/1", false, null, null, jar, noLocation) })
        assertEquals(DownloadFailure.Unsupported, refused { DownloadRules.fetch("data:text/plain,hi", false, null, null, jar, noLocation) })
    }

    @Test
    fun endlessRedirectsStop() {
        val loop = FakeTransport(mapOf("https://a.example/x" to (302 to "https://a.example/x")))
        assertEquals(DownloadFailure.TooManyRedirects, refused { DownloadRules.fetch("https://a.example/x", false, null, null, jar, loop) })
        assertEquals(DownloadRules.MAX_REDIRECTS + 1, loop.sent.size)
    }

    @Test
    fun serverErrorsFail() {
        val missing = FakeTransport(emptyMap())
        assertEquals(DownloadFailure.Server, refused { DownloadRules.fetch("https://a.example/x", false, null, null, jar, missing) })
        val broken = DownloadTransport { _, _ -> throw java.io.IOException("reset") }
        assertEquals(DownloadFailure.Network, refused { DownloadRules.fetch("https://a.example/x", false, null, null, jar, broken) })
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
