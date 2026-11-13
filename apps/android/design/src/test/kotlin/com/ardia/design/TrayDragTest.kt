package com.ardia.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrayDragTest {
    @Test
    fun `downward drags follow the finger exactly`() {
        assertEquals(0.0, TrayDrag.offset(0.0), 0.0)
        assertEquals(84.0, TrayDrag.offset(84.0), 0.0)
    }

    @Test
    fun `upward drags resist, never pass the limit, and match Swift`() {
        val small = TrayDrag.offset(-10.0)
        val large = TrayDrag.offset(-400.0)
        assertTrue(small < 0 && small > -10)
        assertTrue(large < small)
        assertTrue(large > -TrayDrag.upwardLimit)
        assertEquals(-7.826086956521738, small, 1e-12)
        assertEquals(-33.02752293577982, large, 1e-12)
    }

    @Test
    fun `a slow short drag springs back and a slow long one dismisses`() {
        assertFalse(TrayDrag.shouldDismiss(40.0, 60.0, 274.0))
        val distance = TrayDrag.dismissDistance(274.0)
        assertEquals(95.89999999999999, distance, 1e-12)
        assertTrue(TrayDrag.shouldDismiss(distance + 1, 0.0, 274.0))
    }

    @Test
    fun `a flick down dismisses from a short distance`() {
        assertTrue(TrayDrag.shouldDismiss(14.0, 1200.0, 274.0))
    }

    @Test
    fun `moving back up cancels even past the distance and an upward pull never dismisses`() {
        assertFalse(TrayDrag.shouldDismiss(200.0, -600.0, 274.0))
        assertFalse(TrayDrag.shouldDismiss(-20.0, 1500.0, 274.0))
    }

    @Test
    fun `a compact tray needs a proportionally shorter drag`() {
        assertTrue(TrayDrag.dismissDistance(78.0) < TrayDrag.dismissDistance(274.0))
        assertEquals(TrayDrag.distanceCap, TrayDrag.dismissDistance(2000.0), 0.0)
    }

    @Test
    fun `the keyboard waits for a deliberate pull`() {
        assertFalse(TrayDrag.releasesKeyboard(3.0))
        assertFalse(TrayDrag.releasesKeyboard(-30.0))
        assertTrue(TrayDrag.releasesKeyboard(20.0))
    }

    @Test
    fun `progress is clamped to the travel`() {
        assertEquals(0.0, TrayDrag.progress(-10.0, 300.0), 0.0)
        assertEquals(0.5, TrayDrag.progress(150.0, 300.0), 0.0)
        assertEquals(1.0, TrayDrag.progress(900.0, 300.0), 0.0)
        assertEquals(0.0, TrayDrag.progress(50.0, 0.0), 0.0)
    }
}
