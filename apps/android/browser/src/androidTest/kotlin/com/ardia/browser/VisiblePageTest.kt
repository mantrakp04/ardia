package com.ardia.browser

import android.graphics.Color
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
class VisiblePageTest {
    private val harness = PageHarness()
    private val server = harness.server

    @After
    fun tearDown() = harness.close()

    @Test
    fun findCountsMatchesAndMovesBetweenThem() {
        server.page("/fruit", "<title>Fruit</title><p>apple banana</p><p>Apple cherry</p><p>apple</p>")
        val page = harness.open("tab", "/fruit")
        harness.show(page)
        harness.awaitTitle(page, "Fruit")
        onMain { page.find("apple") }
        val found = harness.await(page.find) { it != null && it.isDone && it.total > 0 }!!
        assertEquals("apple", found.query)
        assertEquals(3, found.total)
        val start = found.activeIndex
        onMain { page.findNext() }
        val next = harness.await(page.find) { it != null && it.activeIndex != start }!!
        assertEquals((start + 1) % 3, next.activeIndex)
        onMain { page.findPrevious() }
        harness.await(page.find) { it != null && it.activeIndex == start }
        onMain { page.find("durian") }
        val none = harness.await(page.find) { it != null && it.query == "durian" && it.isDone }!!
        assertEquals(0, none.total)
        assertEquals(-1, none.activeIndex)
        onMain { page.endFind() }
        assertNull(page.find.value)
    }

    @Test
    fun snapshotAndToneReadThePaintedPage() {
        server.page(
            "/red",
            "<title>Red</title><meta name=\"viewport\" content=\"width=device-width\"><style>html,body{margin:0;height:300%;background:#d01010}</style>",
        )
        val page = harness.open("tab", "/red")
        harness.show(page)
        harness.awaitTitle(page, "Red")
        assertEquals(PageColors.opaque(208, 16, 16), harness.await(page.state) { it.backgroundColor != null }.backgroundColor)
        assertPaintedRed(page)
    }

    @Test
    fun drawingThePageFollowsTheScroll() {
        server.page(
            "/bands",
            "<title>Bands</title><meta name=\"viewport\" content=\"width=device-width\">" +
                "<style>html,body{margin:0}#red{height:3000px;background:#d01010}#blue{height:6000px;background:#1010d0}</style>" +
                "<div id=\"red\"></div><div id=\"blue\"></div>",
        )
        val page = harness.open("tab", "/bands")
        val impl = page as WebViewPage
        harness.show(page)
        harness.awaitTitle(page, "Bands")
        assertPaintedRed(page)
        assertEquals(CaptureRoute.ViewDraw, onMain { impl.lastCaptureRoute })
        val intoBlue = (5000 * harness.context.resources.displayMetrics.density).toInt()
        val blue = harness.poll(intervalMillis = 250) {
            onMain { page.view.value?.scrollTo(0, intoBlue) }
            harness.onMainSuspending { page.snapshot(300) }?.takeIf { isBlue(it.getPixel(it.width / 2, it.height / 2)) }
        }
        assertTrue(describe(blue.getPixel(blue.width / 2, blue.height / 10)), isBlue(blue.getPixel(blue.width / 2, blue.height / 10)))
        val tone = harness.onMainSuspending { page.sampleTone(0, 0) }!!
        assertTrue(describe(tone.top), tone.top?.let(::isBlue) == true)
        assertEquals(CaptureRoute.ViewDraw, onMain { impl.lastCaptureRoute })
    }

    private fun assertPaintedRed(page: Page) {
        val snapshot = harness.poll(intervalMillis = 250) {
            harness.onMainSuspending { page.snapshot(300) }?.takeIf { isRed(it.getPixel(it.width / 2, it.height / 2)) }
        }
        val route = onMain { (page as WebViewPage).lastCaptureRoute }
        assertTrue(snapshot.width <= 300)
        val nearTop = snapshot.getPixel(snapshot.width / 2, snapshot.height / 10)
        assertTrue("near the top via $route: ${describe(nearTop)}", isRed(nearTop))
        val tone = harness.onMainSuspending { page.sampleTone(0, 0) }
        assertNotNull("no tone via $route", tone)
        val toneRoute = onMain { (page as WebViewPage).lastCaptureRoute }
        assertTrue("top tone via $toneRoute: ${describe(tone!!.top)}", tone.top?.let(::isRed) == true)
        assertTrue("bottom tone via $toneRoute: ${describe(tone.bottom)}", tone.bottom?.let(::isRed) == true)
    }

    private fun describe(color: Int?): String = color?.let { "#%08X".format(it) } ?: "none"

    private fun isBlue(color: Int): Boolean = Color.blue(color) > 180 && Color.red(color) < 60 && Color.green(color) < 60

    @Test
    fun scrollingDownAndBackReportsTheDirection() {
        server.page(
            "/long",
            "<title>Long</title><meta name=\"viewport\" content=\"width=device-width\"><div style=\"height:6000px\">tall</div>",
        )
        val page = harness.open("tab", "/long")
        harness.show(page)
        harness.awaitTitle(page, "Long")
        val down = harness.poll(intervalMillis = 250) {
            onMain { page.view.value?.scrollTo(0, 800) }
            page.state.value.takeIf { it.scrollDirection == ScrollDirection.Down }
        }
        assertFalse(down.isScrolledToTop)
        onMain { page.view.value?.scrollTo(0, 0) }
        harness.await(page.state) { it.scrollDirection == ScrollDirection.Up && it.isScrolledToTop }
    }

    private fun isRed(color: Int): Boolean = Color.red(color) > 180 && Color.green(color) < 60 && Color.blue(color) < 60
}
