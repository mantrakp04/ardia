package com.ardia.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class LoadProgressTest {
    @Test
    fun `a fast load never shows`() {
        val track = LoadProgress()
        track.start()
        track.advance(0.6)
        track.finish()
        assertEquals(LoadProgress.Phase.Idle, track.phase)
        assertFalse(track.isVisible)
        assertEquals(0.0, track.fraction, 0.0)
    }

    @Test
    fun `it only moves forward while loading`() {
        val track = LoadProgress()
        track.start()
        track.reveal()
        val seen = mutableListOf(track.fraction)
        for (raw in listOf(0.3, 0.1, 0.5, 0.0, 0.45, 0.9, 0.99, Double.NaN)) {
            track.advance(raw)
            seen += track.fraction
        }
        assertEquals(seen.sorted(), seen)
        assertEquals(LoadProgress.CEILING, track.fraction, 0.0)
    }

    @Test
    fun `reveal starts at the floor`() {
        val track = LoadProgress()
        track.start()
        track.advance(0.02)
        track.reveal()
        assertEquals(LoadProgress.FLOOR, track.fraction, 0.0)
    }

    @Test
    fun `finish fills, then fades, then resets`() {
        val track = LoadProgress()
        track.start()
        track.reveal()
        track.advance(0.7)
        track.finish()
        assertEquals(LoadProgress.Phase.Finishing, track.phase)
        assertEquals(1.0, track.fraction, 0.0)
        track.advance(0.0)
        assertEquals(1.0, track.fraction, 0.0)
        track.fade()
        assertFalse(track.isVisible)
        track.settle()
        assertEquals(LoadProgress.Phase.Idle, track.phase)
        assertEquals(0.0, track.fraction, 0.0)
    }

    @Test
    fun `a load that starts during the fade waits for it`() {
        val track = LoadProgress()
        track.start()
        track.reveal()
        track.finish()
        track.start()
        assertEquals(1.0, track.fraction, 0.0)
        track.fade()
        track.settle()
        assertEquals(LoadProgress.Phase.Waiting, track.phase)
        assertEquals(0.0, track.fraction, 0.0)
    }

    @Test
    fun `a redirect that ends during the fade does not restart`() {
        val track = LoadProgress()
        track.start()
        track.reveal()
        track.finish()
        track.start()
        track.finish()
        track.fade()
        track.settle()
        assertEquals(LoadProgress.Phase.Idle, track.phase)
    }
}

class PagerPhysicsTest {
    private val width = 402.0

    @Test
    fun `a slow drag past half commits and a short flick commits by projection`() {
        assertEquals(-1, PagerPhysics.snapTarget(-220.0, 0.0, width, hasLeft = true, hasRight = true))
        assertEquals(1, PagerPhysics.snapTarget(220.0, 0.0, width, hasLeft = true, hasRight = true))
        assertEquals(-1, PagerPhysics.snapTarget(-60.0, -1600.0, width, hasLeft = true, hasRight = true))
    }

    @Test
    fun `flicking back cancels and no neighbour never commits`() {
        assertEquals(0, PagerPhysics.snapTarget(-260.0, 900.0, width, hasLeft = true, hasRight = true))
        assertEquals(0, PagerPhysics.snapTarget(-300.0, -2000.0, width, hasLeft = true, hasRight = false))
        assertEquals(0, PagerPhysics.snapTarget(300.0, 2000.0, width, hasLeft = false, hasRight = true))
    }

    @Test
    fun `the rubber band is monotonic, bounded and matches Swift`() {
        var last = 0.0
        var distance = 1.0
        while (distance <= 2000) {
            val banded = PagerPhysics.rubberBand(distance)
            assertTrue(banded > last)
            assertTrue(banded < PagerPhysics.rubberLimit)
            assertEquals(-banded, PagerPhysics.rubberBand(-distance), 0.0)
            last = banded
            distance += 25
        }
        assertEquals(20.000000000000004, PagerPhysics.rubberBand(30.0), 1e-12)
        assertEquals(-53.57142857142858, PagerPhysics.rubberBand(-500.0), 1e-12)
    }

    @Test
    fun `the outgoing card recedes and the incoming one arrives flush`() {
        val start = PagerPhysics.layout(-1.0, width, hasLeft = true, hasRight = true, reduceMotion = false)
        val end = PagerPhysics.layout(-width, width, hasLeft = true, hasRight = true, reduceMotion = false)
        assertEquals(1, start.incomingSide)
        assertEquals(0.0, end.incoming!!.x, 1e-12)
        assertEquals(1.0, end.incoming!!.scale, 0.0)
        assertEquals(PagerPhysics.recededScale, end.outgoing.scale, 1e-12)
        assertEquals(PagerPhysics.recededDim, end.outgoing.dim, 1e-12)
        assertTrue(start.outgoing.scale > end.outgoing.scale)
    }

    @Test
    fun `the left neighbour comes from the left and reduce motion only crossfades`() {
        val layout = PagerPhysics.layout(120.0, width, hasLeft = true, hasRight = false, reduceMotion = false)
        assertEquals(-1, layout.incomingSide)
        assertEquals(-width + 120, layout.incoming!!.x, 1e-12)
        val reduced = PagerPhysics.layout(-width * 0.4, width, hasLeft = true, hasRight = true, reduceMotion = true)
        assertEquals(PagerCardPose(), reduced.outgoing)
        assertEquals(0.0, reduced.incoming!!.x, 0.0)
        assertEquals(0.4, reduced.incoming!!.opacity, 1e-4)
    }

    @Test
    fun `an edge pull without a neighbour only shrinks the card`() {
        val layout = PagerPhysics.layout(30.0, width, hasLeft = false, hasRight = true, reduceMotion = false)
        assertNull(layout.incoming)
        assertEquals(1 - PagerPhysics.edgeScale * 0.5, layout.outgoing.scale, 1e-12)
        assertEquals(30.0, PagerPhysics.resolvedOffset(30.0, hasLeft = true, hasRight = false, width = width), 0.0)
        assertEquals(PagerPhysics.rubberBand(30.0), PagerPhysics.resolvedOffset(30.0, hasLeft = false, hasRight = false, width = width), 0.0)
    }
}

class DeckHeaderMetricsTest {
    @Test
    fun `the title reveal is continuous and monotonic`() {
        var last = -1.0
        var width = 0.0
        while (width <= 200) {
            val reveal = DeckHeaderMetrics.titleReveal(width)
            assertTrue(reveal >= last)
            assertTrue(reveal - maxOf(last, 0.0) <= 0.5 / (DeckHeaderMetrics.titleShown - DeckHeaderMetrics.titleHidden) + 0.0001)
            last = reveal
            width += 0.5
        }
        assertEquals(0.0, DeckHeaderMetrics.titleReveal(40.0), 0.0)
        assertEquals(1.0, DeckHeaderMetrics.titleReveal(120.0), 0.0)
    }

    @Test
    fun `short titles centre and long ones pin to the leading edge`() {
        assertEquals(50.0, DeckHeaderMetrics.contentLeading(200.0, 16.0, 6.0, 78.0, 1.0), 0.0)
        assertEquals(0.0, DeckHeaderMetrics.contentLeading(200.0, 16.0, 6.0, 400.0, 1.0), 0.0)
    }

    @Test
    fun `leading never jumps as the strip narrows`() {
        var last: Double? = null
        var available = 220.0
        while (available >= 10) {
            val reveal = DeckHeaderMetrics.titleReveal(available)
            val leading = DeckHeaderMetrics.contentLeading(available, 16.0, 6.0, 120.0, reveal)
            last?.let { assertTrue(abs(leading - it) <= 2) }
            last = leading
            available -= 0.5
        }
    }
}
