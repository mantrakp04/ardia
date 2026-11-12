package com.ardia.browser

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PrivatePagesTest {
    private val harness = PageHarness()
    private val server = harness.server

    @Before
    fun setUp() {
        server.route("/set") { request ->
            val value = request.path.substringAfter("value=", "")
            TestServer.Response(
                body = "<script>localStorage.setItem('k', '$value'); document.title = 'set:$value'</script>",
                headers = mapOf("Set-Cookie" to "jar=$value; Path=/"),
            )
        }
        server.page("/read", "<script>document.title = 'read:' + document.cookie + ':' + (localStorage.getItem('k') || '')</script>")
        harness.onMainSuspending { harness.engine.clearWebsiteData(setOf(WebsiteDataKind.CookiesAndSiteData, WebsiteDataKind.Cache)) }
    }

    @After
    fun tearDown() = harness.close()

    private fun read(page: Page): String {
        harness.load(page, "/read?${System.nanoTime()}")
        return harness.await(page.state) { it.title.startsWith("read:") && !it.isLoading }.title
    }

    private fun set(page: Page, value: String) {
        harness.load(page, "/set?value=$value")
        harness.awaitTitle(page, "set:$value")
    }

    @Test
    fun privatePagesKeepTheirOwnCookiesAndStorage() {
        assumeTrue(onMain { harness.engine.separatesPrivatePages })
        val normal = harness.open("normal")
        set(normal, "normal")
        val hidden = harness.open("private", isPrivate = true)
        assertEquals("read::", read(hidden))
        set(hidden, "private")
        assertEquals("read:jar=private:private", read(hidden))
        assertEquals("read:jar=normal:normal", read(normal))
    }

    @Test
    fun privateDataIsGoneOnceTheLastPrivatePageCloses() {
        assumeTrue(onMain { harness.engine.separatesPrivatePages })
        var ended = 0
        onMain { harness.engine.onPrivateBrowsingEnded = { ended += 1 } }
        val first = harness.open("p1", isPrivate = true)
        val second = harness.open("p2", isPrivate = true)
        set(first, "secret")
        assertEquals("read:jar=secret:secret", read(second))
        onMain { harness.engine.close("p1") }
        assertEquals(0, ended)
        assertEquals("read:jar=secret:secret", read(second))
        onMain { harness.engine.close("p2") }
        assertEquals(1, ended)
        val fresh = harness.open("p3", isPrivate = true)
        assertEquals("read::", read(fresh))
    }

    @Test
    fun privateDownloadsCarryThePrivateCookies() {
        assumeTrue(onMain { harness.engine.separatesPrivatePages })
        server.route("/file") {
            TestServer.Response(body = "data", contentType = "application/octet-stream", headers = mapOf("Content-Disposition" to "attachment; filename=\"a.bin\""))
        }
        val hidden = harness.open("private", isPrivate = true)
        set(hidden, "mine")
        val download = harness.expectEvent<PageEvent.Download>(hidden)
        harness.load(hidden, "/file")
        val event = harness.result(download).download
        assertTrue(event.isPrivate)
        assertEquals("jar=mine", event.cookies)
    }

    @Test
    fun clearingCookiesSignsNormalPagesOut() {
        val normal = harness.open("normal")
        set(normal, "kept")
        assertEquals("read:jar=kept:kept", read(normal))
        harness.onMainSuspending { harness.engine.clearWebsiteData(setOf(WebsiteDataKind.CookiesAndSiteData)) }
        assertEquals("read::", read(normal))
    }
}
