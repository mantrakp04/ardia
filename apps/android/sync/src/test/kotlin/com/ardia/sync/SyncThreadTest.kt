package com.ardia.sync

import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncThreadTest {
    private class Watched(private val inner: FakeDevice) : SyncDevice by inner {
        @Volatile
        var started: Thread? = null

        @Volatile
        var activated: Thread? = null

        override fun start() {
            started = Thread.currentThread()
            inner.start()
        }

        override fun becameActive() {
            activated = Thread.currentThread()
            inner.becameActive()
        }
    }

    private fun waitFor(timeoutMs: Long = 5_000, condition: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return true
            Thread.sleep(20)
        }
        return condition()
    }

    @Test
    fun withSyncOffTheSyncThreadEndsOnceItHasNothingToDo() {
        val device = Watched(FakeDevice(enabledOnStart = false))
        val controller = SyncController({ device }, ManualTimers(), idleThreadMs = 100)
        try {
            controller.start()
            assertTrue(waitFor { device.started != null })
            val thread = device.started!!
            assertTrue("the idle sync thread ended", waitFor { !thread.isAlive })
            controller.appForegrounded()
            assertTrue(waitFor { device.activated != null })
        } finally {
            controller.close()
        }
    }

    @Test
    fun whileTheEngineRunsEveryCallStaysOnTheThreadThatStartedIt() {
        val device = Watched(FakeDevice(enabledOnStart = true))
        val controller = SyncController({ device }, ManualTimers(), idleThreadMs = 100)
        try {
            controller.start()
            assertTrue(waitFor { device.started != null })
            val thread = device.started!!
            Thread.sleep(500)
            assertTrue(thread.isAlive)
            controller.appForegrounded()
            assertTrue(waitFor { device.activated != null })
            assertSame(thread, device.activated)
            assertFalse(thread.isInterrupted)
        } finally {
            controller.close()
        }
    }
}
