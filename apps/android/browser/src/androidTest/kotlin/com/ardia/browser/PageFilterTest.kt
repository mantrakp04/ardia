package com.ardia.browser

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PageFilterTest {
    private val harness = PageHarness()
    private val server = harness.server

    @After
    fun tearDown() = harness.close()

    private class TrackerFilter : PageFilter {
        val pageUrls = mutableListOf<String?>()
        val scriptLookups = AtomicInteger()

        override fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean): Boolean {
            if (requestUrl.endsWith("/tracker.js")) synchronized(pageUrls) { pageUrls += pageUrl }
            return requestUrl.endsWith("/tracker.js")
        }

        override fun scriptsAtDocumentStart(pageUrl: String): List<String> {
            scriptLookups.incrementAndGet()
            return if (pageUrl.contains("/article")) listOf("window.__startState = document.readyState;") else emptyList()
        }

        override fun scriptsAtDocumentEnd(pageUrl: String): List<String> =
            if (pageUrl.contains("/article")) {
                listOf("document.title = 'end:' + window.__startState + ':' + typeof window.trackerLoaded + ':' + !!document.getElementById('late');")
            } else {
                emptyList()
            }
    }

    @Test
    fun theFilterBlocksRequestsAndInjectsScriptsAtBothEnds() {
        val filter = TrackerFilter()
        harness.engine.filter = filter
        server.route("/tracker.js") { TestServer.Response(body = "window.trackerLoaded = true;", contentType = "text/javascript") }
        server.page("/article", "<title>Article</title><script src=\"/tracker.js\"></script><p>Body</p><p id=\"late\">Late</p>")
        val page = harness.open("tab", "/article")
        harness.awaitTitle(page, "end:loading:undefined:true")
        assertFalse(server.requested("/tracker.js"))
        val pageUrls = synchronized(filter.pageUrls) { filter.pageUrls.toList() }
        assertTrue(pageUrls.isNotEmpty())
        assertTrue(pageUrls.all { it == server.url("/article") })
        assertTrue(harness.await(page.state) { it.blockedRequests >= 1 }.blockedRequests >= 1)
    }

    @Test
    fun scriptsFollowThePageTheyBelongTo() {
        harness.engine.filter = TrackerFilter()
        server.page("/plain", "<title>Plain</title><script>onload = () => document.title = 'plain:' + typeof window.__startState</script>")
        server.page("/article", "<title>Article</title><p id=\"late\">Late</p>")
        val page = harness.open("tab", "/article")
        harness.awaitTitle(page, "end:loading:undefined:true")
        harness.load(page, "/plain")
        harness.awaitTitle(page, "plain:undefined")
        assertEquals(0, harness.await(page.state) { !it.isLoading }.blockedRequests)
    }

    @Test
    fun withoutAFilterNothingIsBlocked() {
        server.route("/tracker.js") { TestServer.Response(body = "window.trackerLoaded = true;", contentType = "text/javascript") }
        server.page("/open", "<script src=\"/tracker.js\"></script><script>onload = () => document.title = 'loaded:' + window.trackerLoaded</script>")
        val page = harness.open("tab", "/open")
        harness.awaitTitle(page, "loaded:true")
        assertTrue(server.requested("/tracker.js"))
    }

    @Test
    fun nightShadeShadesLightPagesWhenAlwaysOn() {
        val shaded = PageHarness(RecordingPreferences(NightShadeMode.Always))
        try {
            shaded.server.page(
                "/light",
                "<body style=\"background:#fff\"><p>Light</p><script>let tries = 0; const check = setInterval(() => {" +
                    " if (document.getElementById('ardia-night-shade')) { document.title = 'shaded'; clearInterval(check) }" +
                    " else if (++tries > 150) { document.title = 'plain'; clearInterval(check) } }, 100)</script></body>",
            )
            val page = shaded.open("tab", "/light")
            shaded.awaitTitle(page, "shaded")
        } finally {
            shaded.close()
        }
    }
}
