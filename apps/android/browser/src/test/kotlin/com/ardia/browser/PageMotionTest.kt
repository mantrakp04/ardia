package com.ardia.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageMotionTest {
    @Test
    fun progressPublishesWholePercentsAtMostEveryHundredMilliseconds() {
        val throttle = ProgressThrottle()
        assertEquals(0.1f, throttle.offer(0.104, 1_000)!!, 0f)
        assertNull(throttle.offer(0.109, 1_200))
        assertNull(throttle.offer(0.3, 1_050))
        assertEquals(0.3f, throttle.offer(0.3, 1_100)!!, 0f)
    }

    @Test
    fun progressAlwaysPublishesTheFinish() {
        val throttle = ProgressThrottle()
        throttle.offer(0.5, 1_000)
        assertEquals(1f, throttle.offer(1.4, 1_001)!!, 0f)
        throttle.reset()
        assertEquals(0f, throttle.published, 0f)
        assertEquals(0.2f, throttle.offer(0.2, 1_002)!!, 0f)
    }

    @Test
    fun scrollingDownPastTheThresholdTurnsDown() {
        val tracker = ScrollDirectionTracker()
        assertNull(tracker.offer(10.0, 2_000.0, 800.0))
        assertEquals(ScrollDirection.Down, tracker.offer(30.0, 2_000.0, 800.0))
        assertNull(tracker.offer(200.0, 2_000.0, 800.0))
    }

    @Test
    fun scrollingBackUpPastTheThresholdTurnsUp() {
        val tracker = ScrollDirectionTracker()
        tracker.offer(100.0, 2_000.0, 800.0)
        tracker.offer(400.0, 2_000.0, 800.0)
        assertNull(tracker.offer(390.0, 2_000.0, 800.0))
        assertEquals(ScrollDirection.Up, tracker.offer(360.0, 2_000.0, 800.0))
    }

    @Test
    fun theBottomBounceDoesNotFlipDirection() {
        val tracker = ScrollDirectionTracker()
        tracker.offer(600.0, 2_000.0, 800.0)
        assertEquals(ScrollDirection.Down, tracker.direction)
        assertNull(tracker.offer(1_200.0, 2_000.0, 800.0))
        assertNull(tracker.offer(1_190.0, 2_000.0, 800.0))
        assertEquals(ScrollDirection.Down, tracker.direction)
    }

    @Test
    fun theTopAlwaysMeansUp() {
        val tracker = ScrollDirectionTracker()
        tracker.offer(600.0, 2_000.0, 800.0)
        assertEquals(ScrollDirection.Up, tracker.offer(0.0, 2_000.0, 800.0))
    }

    @Test
    fun zoomStepsThroughTheIphoneLevels() {
        assertEquals(1.15, PageZoom.next(1.0)!!, 0.0)
        assertEquals(0.85, PageZoom.previous(1.0)!!, 0.0)
        assertNull(PageZoom.next(3.0))
        assertNull(PageZoom.previous(0.5))
        assertEquals(3.0, PageZoom.clamp(9.0), 0.0)
        assertEquals(0.5, PageZoom.clamp(0.1), 0.0)
    }
}
