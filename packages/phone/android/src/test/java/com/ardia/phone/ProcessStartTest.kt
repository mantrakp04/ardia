package com.ardia.phone

import org.junit.Assert.assertEquals
import org.junit.Test

class ProcessStartTest {
    @Test
    fun theStartIsNowLessHowLongTheProcessHasBeenRunning() {
        assertEquals(1_800_000_000_000.0, ProcessStart.epochMillis(nowMillis = 1_800_000_004_500L, elapsedNow = 90_500L, startElapsed = 86_000L), 0.0)
        assertEquals(1_800_000_000_000.0, ProcessStart.epochMillis(nowMillis = 1_800_000_000_000L, elapsedNow = 5_000L, startElapsed = 5_000L), 0.0)
        assertEquals(1_800_000_000_000.0, ProcessStart.epochMillis(nowMillis = 1_800_000_000_000L, elapsedNow = 5_000L, startElapsed = 9_000L), 0.0)
    }
}
