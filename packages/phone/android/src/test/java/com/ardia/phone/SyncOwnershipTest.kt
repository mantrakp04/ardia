package com.ardia.phone

import com.ardia.sync.FakeDevice
import com.ardia.sync.ManualTimers
import com.ardia.sync.RecordingScheduler
import com.ardia.sync.SyncController
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncOwnershipTest {
    @Test
    fun cycleRequestsArrivingTogetherRunOneAtATimeOnTheSyncThread() = runBlocking {
        val device = FakeDevice()
        val inFlight = AtomicInteger()
        val most = AtomicInteger()
        val started = CountDownLatch(1)
        device.duringSync = {
            val now = inFlight.incrementAndGet()
            most.accumulateAndGet(now, ::maxOf)
            started.countDown()
            Thread.sleep(40)
            inFlight.decrementAndGet()
        }
        val controller = SyncController(device, ManualTimers(), RecordingScheduler())
        controller.start()
        withTimeout(10_000) {
            val requests = List(6) { index ->
                async(Dispatchers.Default) {
                    if (index % 2 == 0) controller.syncNow() else controller.backgroundCycle()
                }
            }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            controller.appBackgrounded()
            controller.localDidChange()
            requests.awaitAll()
        }
        controller.close()
        assertEquals("never two cycles at once", 1, most.get())
        assertTrue("every cycle ran: ${device.calls}", device.syncs >= 6)
        val syncThreads = device.calls.indices.filter { device.calls[it] == "sync" }.map { device.threads[it] }.toSet()
        assertEquals(setOf(SyncController.THREAD_NAME), syncThreads)
    }
}
