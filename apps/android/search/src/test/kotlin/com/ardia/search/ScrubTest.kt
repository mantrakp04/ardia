package com.ardia.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrubTest {
    private fun rows(): ScrubState {
        val state = ScrubState()
        state.targets.resize(3)
        state.targets.place(0, 8f, 0f, 392f, 58f)
        state.targets.place(1, 8f, 58f, 392f, 116f)
        state.targets.place(2, 8f, 116f, 392f, 200f)
        return state
    }

    @Test
    fun aPointFindsTheRowUnderItWithSideSlackButNotBeyondTheBudget() {
        val targets = rows().targets
        assertEquals(1, targets.hit(200f, 60f, 300f, 8f))
        assertEquals(0, targets.hit(2f, 10f, 300f, 8f))
        assertEquals(ScrubTargets.NONE, targets.hit(-5f, 10f, 300f, 8f))
        assertEquals(ScrubTargets.NONE, targets.hit(200f, 150f, 120f, 8f))
        assertEquals(ScrubTargets.NONE, targets.hit(200f, 250f, 300f, 8f))
    }

    @Test
    fun rowsWithoutAPlacementAreNeverHit() {
        val state = ScrubState()
        state.targets.resize(2)
        assertEquals(ScrubTargets.NONE, state.targets.hit(10f, 0f, 300f, 8f))
    }

    @Test
    fun aTapHighlightsAndActivatesWithoutCountingAsAScrub() {
        val state = rows()
        state.begin(100f, 20f, 300f, 8f)
        assertEquals(0, state.highlighted)
        val release = state.end(101f, 22f, 300f, 8f)
        assertEquals(ScrubState.Release.Activate(0, wasScrubbing = false), release)
        assertEquals(ScrubTargets.NONE, state.highlighted)
    }

    @Test
    fun draggingAlongTheRowsTicksOnEachNewRowAndReleasingActivatesTheLastOne() {
        val state = rows()
        state.begin(100f, 20f, 300f, 8f)
        assertFalse(state.move(100f, 40f, 300f, 8f, 6f))
        assertTrue(state.move(100f, 70f, 300f, 8f, 6f))
        assertFalse(state.move(100f, 80f, 300f, 8f, 6f))
        assertTrue(state.move(100f, 150f, 300f, 8f, 6f))
        assertEquals(2, state.highlighted)
        assertEquals(ScrubState.Release.Activate(2, wasScrubbing = true), state.end(100f, 150f, 300f, 8f))
    }

    @Test
    fun releasingOffTheRowsActivatesNothing() {
        val state = rows()
        state.begin(100f, 20f, 300f, 8f)
        state.move(100f, 260f, 300f, 8f, 6f)
        assertEquals(ScrubTargets.NONE, state.highlighted)
        assertEquals(ScrubState.Release.Nothing, state.end(100f, 260f, 300f, 8f))
    }

    @Test
    fun shrinkingTheListForgetsRowsThatLeft() {
        val state = rows()
        state.targets.resize(1)
        assertEquals(ScrubTargets.NONE, state.targets.hit(100f, 70f, 300f, 8f))
        state.targets.resize(3)
        assertEquals(ScrubTargets.NONE, state.targets.hit(100f, 70f, 300f, 8f))
    }
}
