package com.ardia.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrayLiftTest {
    @Test
    fun theKeyboardCountsAsUpOnlyAboveTheThreshold() {
        assertFalse(TrayLift.isKeyboardUp(48f))
        assertFalse(TrayLift.isKeyboardUp(120f))
        assertTrue(TrayLift.isKeyboardUp(121f))
    }

    @Test
    fun progressFollowsTheKeyboardBothWays() {
        assertEquals(0.5f, TrayLift.keyboardProgress(150f, 0f, 300f), 0.0001f)
        assertEquals(0.25f, TrayLift.keyboardProgress(75f, 300f, 0f), 0.0001f)
        assertEquals(1f, TrayLift.keyboardProgress(300f, 300f, 300f), 0.0001f)
        assertEquals(0f, TrayLift.keyboardProgress(40f, 40f, 40f), 0.0001f)
    }

    @Test
    fun aLandedTrayRestsAboveTheGestureBarWhenTheKeyboardIsDown() {
        assertEquals(24f, TrayLift.liveLift(0f, 24f, hasLanded = true, isClosing = false), 0f)
        assertEquals(0f, TrayLift.liveLift(0f, 24f, hasLanded = false, isClosing = false), 0f)
        assertEquals(0f, TrayLift.liveLift(0f, 24f, hasLanded = true, isClosing = true), 0f)
        assertEquals(300f, TrayLift.liveLift(300f, 24f, hasLanded = true, isClosing = false), 0f)
    }

    @Test
    fun aRisenTraySitsOnTheKeyboardAndAFallenOneIsFullyBelowTheScreen() {
        assertEquals(-300f, TrayLift.offset(lift = 300f, drag = 0f, rise = 1f, trayHeight = 274f, cornerRadius = 40f), 0.001f)
        assertEquals(314f, TrayLift.offset(lift = 0f, drag = 0f, rise = 0f, trayHeight = 274f, cornerRadius = 40f), 0.001f)
        assertEquals(314f, TrayLift.offset(lift = 300f, drag = 0f, rise = 0f, trayHeight = 274f, cornerRadius = 40f), 0.001f)
    }

    @Test
    fun followingTheKeyboardFrameByFrameNeverMovesBackward() {
        var previous = Float.MAX_VALUE
        for (step in 0..60) {
            val progress = step / 60f
            val y = TrayLift.offset(lift = 300f * progress, drag = 0f, rise = progress, trayHeight = 274f, cornerRadius = 40f)
            assertTrue(y <= previous)
            previous = y
        }
    }

    @Test
    fun theTrayIsShorterWhenTheScreenLeavesLessRoom() {
        assertEquals(274f, TrayLift.maxHeight(274f, 800f, 300f, 8f), 0f)
        assertEquals(192f, TrayLift.maxHeight(274f, 500f, 300f, 8f), 0f)
        assertEquals(0f, TrayLift.maxHeight(274f, 200f, 300f, 8f), 0f)
    }

    @Test
    fun dragProgressIsClampedToTheTravel() {
        assertEquals(0.5f, TrayLift.dragProgress(150f, 300f), 0f)
        assertEquals(0f, TrayLift.dragProgress(-20f, 300f), 0f)
        assertEquals(1f, TrayLift.dragProgress(500f, 300f), 0f)
        assertEquals(0f, TrayLift.dragProgress(10f, 0f), 0f)
    }
}
