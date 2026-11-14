package com.ardia.browser

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PageNavigationTest {
    private val preferences = RecordingPreferences()
    private val harness = PageHarness(preferences)
    private val server = harness.server

    @After
    fun tearDown() = harness.close()

    @Test
    fun navigationStateFollowsLoadsAndHistory() {
        server.page("/one", "<title>One</title><meta name=\"theme-color\" content=\"#336699\"><p>first</p>")
        server.page("/two", "<title>Two</title><p>second</p>")
        val page = harness.open("tab", "/one")
        val first = harness.awaitTitle(page, "One")
        assertEquals(server.url("/one"), first.url)
        assertTrue(first.isLive)
        assertFalse(first.canGoBack)
        assertEquals(PageSecurity.Insecure, first.security)
        harness.await(page.state) { it.themeColor != null && it.faviconUrl != null }.also {
            assertEquals(0xFF336699.toInt(), it.themeColor)
            assertEquals(server.url("/favicon.ico"), it.faviconUrl)
        }

        val typed = harness.expectEvent<PageEvent.Visited>(page) { it.url == server.url("/two") }
        harness.load(page, "/two")
        val second = harness.awaitTitle(page, "Two")
        assertTrue(second.canGoBack)
        assertFalse(second.canGoForward)
        assertEquals(0f, second.progress)
        assertNull(second.themeColor)
        assertEquals(VisitKind.Typed, harness.result(typed).kind)

        val back = harness.expectEvent<PageEvent.Visited>(page) { it.url == server.url("/one") }
        assertTrue(onMain { page.goBack() })
        val returned = harness.awaitTitle(page, "One")
        assertTrue(returned.canGoForward)
        assertEquals(VisitKind.BackForward, harness.result(back).kind)
        assertTrue(onMain { page.goForward() })
        harness.awaitTitle(page, "Two")
        assertFalse(onMain { page.goForward() })
    }

    @Test
    fun aLinkTheScriptFollowsIsALinkVisit() {
        server.page("/start", "<title>Start</title><script>setTimeout(() => location.href = '/next', 5000)</script>")
        server.page("/next", "<title>Next</title>")
        val page = harness.open("tab", "/start")
        harness.awaitTitle(page, "Start")
        val visit = harness.expectEvent<PageEvent.Visited>(page) { it.url == server.url("/next") }
        harness.awaitTitle(page, "Next")
        assertEquals(VisitKind.Link, harness.result(visit).kind)
    }

    @Test
    fun anUnreachableServerIsALoadFailureThatReloadClears() {
        server.page("/ok", "<title>Fine</title>")
        val page = harness.open("tab")
        onMain { page.load("http://127.0.0.1:1/") }
        val failed = harness.await(page.state) { it.failure != null }
        assertTrue(failed.failure is PageLoadFailure.Network)
        harness.load(page, "/ok")
        assertNull(harness.awaitTitle(page, "Fine").failure)
    }

    @Test
    fun pageZoomIsAppliedAndRememberedPerSite() {
        server.page("/zoom", "<title>Zoom</title>")
        val page = harness.open("tab", "/zoom")
        harness.awaitTitle(page, "Zoom")
        onMain { page.zoomIn() }
        assertEquals(1.15, page.state.value.pageZoom, 0.0)
        assertEquals(1.15, preferences.zooms["127.0.0.1"]!!, 0.0)
        onMain { page.setPageZoom(1.0) }
        assertNull(preferences.zooms["127.0.0.1"])
        onMain { page.setPageZoom(9.0) }
        assertEquals(3.0, page.state.value.pageZoom, 0.0)
    }

    @Test
    fun desktopSiteReloadsWithADesktopAgent() {
        server.page("/agent", "<script>document.title = /X11/.test(navigator.userAgent) ? 'desktop' : (/; wv\\)/.test(navigator.userAgent) ? 'webview' : 'mobile')</script>")
        val page = harness.open("tab", "/agent")
        harness.awaitTitle(page, "mobile")
        onMain { page.setDesktopSite(true) }
        assertTrue(harness.awaitTitle(page, "desktop").isDesktopSite)
        val agent = server.requests.last { it.path == "/agent" }.headers["user-agent"].orEmpty()
        assertTrue(agent.contains("X11"))
    }

    @Test
    fun attachmentsBecomeDownloadEvents() {
        server.route("/report") {
            TestServer.Response(
                body = "%PDF-1.4",
                contentType = "application/pdf",
                headers = mapOf("Content-Disposition" to "attachment; filename=\"report.pdf\"", "Set-Cookie" to "dl=1; Path=/"),
            )
        }
        server.page("/home", "<title>Home</title>")
        val page = harness.open("tab", "/home")
        harness.awaitTitle(page, "Home")
        val download = harness.expectEvent<PageEvent.Download>(page)
        harness.load(page, "/report")
        val event = harness.result(download).download
        assertEquals(server.url("/report"), event.url)
        assertEquals("report.pdf", event.fileName)
        assertEquals("application/pdf", event.mimeType)
        assertFalse(event.isPrivate)
    }

    @Test
    fun theRosterDropsOldPagesAndRestoresTheirHistory() {
        val limited = PageHarness(liveLimit = 1)
        try {
            limited.server.page("/a", "<title>A</title>")
            limited.server.page("/b", "<title>B</title>")
            limited.server.page("/c", "<title>C</title>")
            val first = limited.open("first", "/a")
            limited.awaitTitle(first, "A")
            limited.load(first, "/b")
            limited.awaitTitle(first, "B")
            val second = limited.open("second", "/c")
            limited.awaitTitle(second, "C")
            assertFalse(first.state.value.isLive)
            assertNull(first.view.value)
            assertEquals(listOf("second"), onMain { limited.engine.livePageIds })
            assertNotNull(onMain { first.saveState() })

            limited.open("first")
            val restored = limited.await(first.state) { it.isLive && it.title == "B" && !it.isLoading && it.canGoBack }
            assertEquals(limited.server.url("/b"), restored.url)
            assertFalse(second.state.value.isLive)
            assertTrue(onMain { first.goBack() })
            limited.awaitTitle(first, "A")
        } finally {
            limited.close()
        }
    }

    @Test
    fun savedStateRebuildsAPageInANewEngine() {
        server.page("/x", "<title>X</title>")
        server.page("/y", "<title>Y</title>")
        val page = harness.open("tab", "/x")
        harness.awaitTitle(page, "X")
        harness.load(page, "/y")
        harness.awaitTitle(page, "Y")
        val saved = onMain { page.saveState() }!!
        val other = PageHarness()
        try {
            val rebuilt = onMain { other.engine.open("again", PageSetup(url = server.url("/y"), savedState = saved)) }
            other.await(rebuilt.state) { it.title == "Y" && !it.isLoading && it.canGoBack }
        } finally {
            onMain { other.engine.close("again") }
            other.close()
        }
    }
}
