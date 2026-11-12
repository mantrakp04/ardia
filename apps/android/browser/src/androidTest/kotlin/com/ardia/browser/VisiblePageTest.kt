package com.ardia.browser

import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
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
        Thread.sleep(800)
        val snapshot = harness.onMainSuspending { page.snapshot(300) }
        assertNotNull(snapshot)
        assertTrue(snapshot!!.width <= 300)
        val center = snapshot.getPixel(snapshot.width / 2, snapshot.height / 2)
        assertTrue(Color.red(center) > 180 && Color.green(center) < 60)
        val tone = harness.onMainSuspending { page.sampleTone(0, 0) }!!
        assertTrue(Color.red(tone.top!!) > 180 && Color.green(tone.top!!) < 60)
        assertTrue(Color.red(tone.bottom!!) > 180)
    }

    @Test
    fun scrollingDownAndBackReportsTheDirection() {
        server.page(
            "/long",
            "<title>Long</title><meta name=\"viewport\" content=\"width=device-width\"><div style=\"height:6000px\">tall</div>" +
                "<script>setTimeout(() => window.scrollTo(0, 800), 1000); setTimeout(() => window.scrollTo(0, 0), 3000)</script>",
        )
        val page = harness.open("tab", "/long")
        harness.show(page)
        harness.awaitTitle(page, "Long")
        val down = harness.await(page.state) { it.scrollDirection == ScrollDirection.Down }
        assertTrue(!down.isScrolledToTop)
        harness.await(page.state) { it.scrollDirection == ScrollDirection.Up && it.isScrolledToTop }
    }
}
