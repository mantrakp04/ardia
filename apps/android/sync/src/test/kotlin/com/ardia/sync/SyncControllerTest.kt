package com.ardia.sync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncControllerTest {
    private class Harness(enabled: Boolean = true) {
        val timers = ManualTimers()
        val device = FakeDevice(enabled)
        val background = RecordingScheduler()
        val controller = SyncController(device, timers, background, inline)
    }

    private fun launched(): Harness = Harness().apply {
        controller.start()
        controller.appForegrounded()
    }

    @Test
    fun launchStartsTheDeviceAndRunsOneCycle() {
        val h = Harness()
        h.controller.start()
        assertEquals(listOf("start", "sync"), h.device.calls)
        assertEquals(SyncPhase.Updated, h.controller.state.value.phase)
        assertEquals("Updated just now", h.controller.state.value.statusText)
        assertEquals(listOf(true), h.background.updates)
    }

    @Test
    fun aDeviceThatIsOffNeverCyclesAndCancelsBackgroundWork() {
        val h = Harness(enabled = false)
        h.controller.start()
        h.controller.appForegrounded()
        h.timers.advance(120_000)
        h.controller.localDidChange()
        h.timers.advance(10_000)
        assertEquals(0, h.device.syncs)
        assertEquals(listOf(false), h.background.updates)
        assertEquals(0, h.timers.waiting)
    }

    @Test
    fun theForegroundCyclesEveryFifteenSecondsAfterTheLastCycleAndStopsInTheBackground() {
        val h = launched()
        val afterLaunch = h.device.syncs
        h.timers.advance(14_999)
        assertEquals(afterLaunch, h.device.syncs)
        h.timers.advance(1)
        assertEquals(afterLaunch + 1, h.device.syncs)
        h.timers.advance(45_000)
        assertEquals(afterLaunch + 4, h.device.syncs)
        h.controller.appBackgrounded()
        h.timers.advance(300_000)
        assertEquals(afterLaunch + 4, h.device.syncs)
        h.controller.appForegrounded()
        assertEquals(afterLaunch + 5, h.device.syncs)
        h.timers.advance(15_000)
        assertEquals(afterLaunch + 6, h.device.syncs)
    }

    @Test
    fun aCycleFromAnyCausePushesTheNextLoopCycleFifteenSecondsOut() {
        val h = launched()
        h.timers.advance(10_000)
        val before = h.device.syncs
        runBlocking { h.controller.syncNow() }
        assertEquals(before + 1, h.device.syncs)
        h.timers.advance(14_000)
        assertEquals(before + 1, h.device.syncs)
        h.timers.advance(1_000)
        assertEquals(before + 2, h.device.syncs)
    }

    @Test
    fun aLocalChangeSyncsThreeSecondsAfterTheLastChange() {
        val h = Harness()
        h.controller.start()
        val before = h.device.syncs
        h.controller.localDidChange()
        h.timers.advance(2_000)
        h.controller.localDidChange()
        h.timers.advance(2_999)
        assertEquals(before, h.device.syncs)
        h.timers.advance(1)
        assertEquals(before + 1, h.device.syncs)
        h.timers.advance(60_000)
        assertEquals(before + 1, h.device.syncs)
    }

    @Test
    fun aCycleThatStartsFirstTakesThePendingChangeWithIt() {
        val h = Harness()
        h.controller.start()
        h.controller.localDidChange()
        h.timers.advance(1_000)
        runBlocking { h.controller.syncNow() }
        val after = h.device.syncs
        h.timers.advance(10_000)
        assertEquals(after, h.device.syncs)
    }

    @Test
    fun goingToTheBackgroundWithAnUnsentChangeFlushesItAtOnceAndCancelsTheBackupWork() {
        val h = launched()
        h.controller.localDidChange()
        val before = h.device.syncs
        h.controller.appBackgrounded()
        assertEquals(before + 1, h.device.syncs)
        assertEquals("inactive", h.device.calls[h.device.calls.lastIndexOf("sync") - 1])
        assertEquals(1, h.background.flushes)
        assertEquals(1, h.background.flushesDone)
        h.timers.advance(60_000)
        assertEquals(before + 1, h.device.syncs)
    }

    @Test
    fun aFlushThatDoesNotLandLeavesTheBackupWorkQueued() {
        val h = launched()
        h.device.nextPhase = SyncPhase.Offline
        h.controller.localDidChange()
        h.controller.appBackgrounded()
        assertEquals(1, h.background.flushes)
        assertEquals(0, h.background.flushesDone)
    }

    @Test
    fun goingToTheBackgroundWithNothingWaitingRunsNoCycle() {
        val h = launched()
        val before = h.device.syncs
        h.controller.appBackgrounded()
        assertEquals(before, h.device.syncs)
        assertEquals(0, h.background.flushes)
    }

    @Test
    fun aSlowCycleShowsUpdatingAfterOneSecondAndAFastOneNever() {
        val h = launched()
        val seen = ArrayList<SyncState>()
        h.device.duringSync = {
            h.timers.advance(999)
            seen += h.controller.state.value
        }
        runBlocking { h.controller.syncNow() }
        assertEquals(SyncPhase.Updated, seen.single().phase)
        assertTrue(seen.single().isSyncing)
        seen.clear()
        h.device.pendingDownloads = 2
        runBlocking { h.controller.syncNow() }
        h.device.duringSync = {
            h.timers.advance(1_000)
            seen += h.controller.state.value
        }
        runBlocking { h.controller.syncNow() }
        assertEquals(SyncPhase.Updating, seen.last().phase)
        assertEquals("Updating · Waiting for 2 files to download", seen.last().statusText)
        assertEquals(SyncPhase.Updated, h.controller.state.value.phase)
        assertFalse(h.controller.state.value.isSyncing)
    }

    @Test
    fun connectingStartsTheLoopAndAFailedConnectStartsNothing() {
        val h = Harness(enabled = false)
        h.controller.start()
        h.device.connectResult = ConnectResult.Mismatch
        val failed = runBlocking { h.controller.connect("words", SyncFolderPick.Tree("content://tree")) }
        assertEquals(ConnectResult.Mismatch, failed)
        h.timers.advance(60_000)
        assertEquals(0, h.device.syncs)
        h.device.connectResult = ConnectResult.Connected
        val joined = runBlocking { h.controller.connect("words", SyncFolderPick.Tree("content://tree")) }
        assertEquals(ConnectResult.Connected, joined)
        assertEquals(1, h.device.syncs)
        assertTrue(h.controller.state.value.isEnabled)
        assertEquals("Ardia Sync", h.controller.state.value.folderName)
        h.timers.advance(15_000)
        assertEquals(2, h.device.syncs)
        assertEquals(listOf(false, true), h.background.updates)
    }

    @Test
    fun choosingTheFolderAgainResumesTheForegroundLoopLikeJoining() {
        val h = Harness()
        h.device.startsNeedingFolder = true
        h.controller.start()
        h.controller.appForegrounded()
        assertEquals(SyncPhase.NeedsFolderAccess, h.controller.state.value.phase)
        assertEquals("Choose Your Sync Folder Again", h.controller.state.value.words.rowSubtitle.text)
        h.timers.advance(60_000)
        assertEquals(0, h.device.syncs)
        assertEquals(ConnectResult.Connected, runBlocking { h.controller.changeFolder(SyncFolderPick.Tree("content://tree")) })
        assertEquals(1, h.device.syncs)
        assertEquals(SyncPhase.Updated, h.controller.state.value.phase)
        h.timers.advance(14_999)
        assertEquals(1, h.device.syncs)
        h.timers.advance(1)
        assertEquals(2, h.device.syncs)
        h.timers.advance(45_000)
        assertEquals(5, h.device.syncs)
        h.controller.appBackgrounded()
        h.timers.advance(60_000)
        assertEquals(5, h.device.syncs)
    }

    @Test
    fun choosingTheFolderAgainInTheBackgroundSyncsOnceAndTheLoopWaitsForTheForeground() {
        val h = Harness()
        h.device.startsNeedingFolder = true
        h.controller.start()
        h.controller.appForegrounded()
        h.controller.appBackgrounded()
        assertEquals(ConnectResult.Connected, runBlocking { h.controller.changeFolder(SyncFolderPick.Tree("content://tree")) })
        assertEquals(1, h.device.syncs)
        h.timers.advance(60_000)
        assertEquals(1, h.device.syncs)
        h.controller.appForegrounded()
        assertEquals(2, h.device.syncs)
        h.timers.advance(15_000)
        assertEquals(3, h.device.syncs)
    }

    @Test
    fun aFolderThatDoesNotMatchStartsNoLoop() {
        val h = Harness()
        h.device.startsNeedingFolder = true
        h.controller.start()
        h.controller.appForegrounded()
        h.device.connectResult = ConnectResult.Mismatch
        assertEquals(ConnectResult.Mismatch, runBlocking { h.controller.changeFolder(SyncFolderPick.Tree("content://other")) })
        h.timers.advance(60_000)
        assertEquals(0, h.device.syncs)
        assertEquals(SyncPhase.NeedsFolderAccess, h.controller.state.value.phase)
    }

    @Test
    fun aForegroundThatEndsBeforeItsWorkRunsStartsNoLoop() {
        val timers = ManualTimers()
        val device = FakeDevice()
        val queued = ArrayList<Runnable>()
        val controller = SyncController(device, timers, RecordingScheduler(), java.util.concurrent.Executor { queued += it })
        controller.start()
        controller.appForegrounded()
        controller.appBackgrounded()
        while (queued.isNotEmpty()) queued.removeAt(0).run()
        val after = device.syncs
        timers.advance(60_000)
        while (queued.isNotEmpty()) queued.removeAt(0).run()
        assertEquals(after, device.syncs)
    }

    @Test
    fun stoppingEndsTheLoopTheDebounceAndBackgroundWork() {
        val h = launched()
        h.controller.localDidChange()
        runBlocking { h.controller.stopSyncing() }
        val after = h.device.syncs
        h.timers.advance(120_000)
        assertEquals(after, h.device.syncs)
        assertEquals(SyncPhase.Off, h.controller.state.value.phase)
        assertEquals(listOf(true, false), h.background.updates)
        assertEquals(0, h.timers.waiting)
    }

    @Test
    fun aResetSeenByACycleEndsTheLoop() {
        val h = launched()
        h.device.duringSync = {
            h.device.isEnabled = false
            h.device.phase = SyncPhase.Reset
        }
        h.timers.advance(15_000)
        val after = h.device.syncs
        h.timers.advance(120_000)
        assertEquals(after, h.device.syncs)
        assertEquals("Out of Sync", h.controller.state.value.words.rowSubtitle.text)
    }

    @Test
    fun sendingAndPinningRunACycleAndAPrivateTabIsRefused() {
        val h = launched()
        val mac = SyncedDevice("mac", "MacBook Pro", SyncedDevice.MAC, null, isCurrent = false, canReceiveTabs = true)
        val before = h.device.syncs
        assertTrue(runBlocking { h.controller.send("https://a.example/", "A", mac) })
        assertEquals(before + 1, h.device.syncs)
        assertTrue(runBlocking { h.controller.pinToMac("https://a.example/", "A") })
        assertEquals(before + 2, h.device.syncs)
        assertFalse(runBlocking { h.controller.pinToMac("https://a.example/", "A", fromPrivateTab = true) })
        assertFalse(runBlocking { h.controller.send("https://a.example/", "A", mac, fromPrivateTab = true) })
        assertEquals(before + 2, h.device.syncs)
    }

    @Test
    fun aSentTabIsAnnouncedOnceEvenWhenItArrivesAgain() {
        val h = launched()
        val tab = ReceivedTab("send:1", "https://sent.example/", "Sent", "MacBook Pro", 1, "p", "mac")
        h.device.pendingReceived = listOf(tab)
        runBlocking { h.controller.syncNow() }
        assertEquals(listOf(tab), h.controller.incoming.value)
        h.controller.clearIncoming()
        h.device.pendingReceived = listOf(tab)
        runBlocking { h.controller.syncNow() }
        assertTrue(h.controller.incoming.value.isEmpty())
    }

    @Test
    fun theSnapshotTheSelectedSpaceAndItsReceiversAreObservable() {
        val h = Harness()
        h.device.syncedSnapshot = SyncDemo.snapshot(h.timers.now)
        h.controller.start()
        assertEquals("Personal", h.controller.selectedProfile.value?.name)
        assertEquals(listOf("MacBook Pro"), h.controller.receivers.value.map { it.name })
        h.controller.selectProfile("demo-work")
        assertEquals("Work", h.controller.selectedProfile.value?.name)
        assertEquals("demo-work", h.controller.state.value.selectedProfileId)
        assertEquals(listOf("MacBook Pro"), h.controller.receivers("demo-personal").map { it.name })
    }

    @Test
    fun renamingTheDeviceSyncsThreeSecondsLater() {
        val h = Harness()
        h.controller.start()
        val before = h.device.syncs
        h.controller.setDeviceName("Pixel")
        assertEquals("Pixel", h.controller.state.value.deviceName)
        h.timers.advance(3_000)
        assertEquals(before + 1, h.device.syncs)
        h.controller.setDeviceName("Pixel")
        h.timers.advance(3_000)
        assertEquals(before + 1, h.device.syncs)
    }

    @Test
    fun aStoppedBackgroundRunCancelsTheFolderReads() {
        val timers = ManualTimers()
        val device = FakeDevice()
        val gate = java.util.concurrent.CountDownLatch(1)
        device.duringSync = { gate.await(5, java.util.concurrent.TimeUnit.SECONDS) }
        val controller = SyncController(device, timers, RecordingScheduler())
        try {
            controller.start()
            runBlocking {
                val run = async(Dispatchers.Default) { controller.backgroundCycle() }
                Thread.sleep(100)
                run.cancel()
                gate.countDown()
            }
            withTimeoutBlocking { controller.syncNow() }
            assertTrue(device.cancelledCoordination >= 1)
        } finally {
            controller.close()
        }
    }

    @Test
    fun everyDeviceCallRunsOnTheSyncThreadNeverTheCaller() {
        val timers = ManualTimers()
        val device = FakeDevice()
        val controller = SyncController(device, timers, RecordingScheduler())
        try {
            controller.start()
            controller.appForegrounded()
            withTimeoutBlocking {
                controller.connect("words", SyncFolderPick.Folder(java.io.File("/tmp")))
                controller.syncNow()
                controller.send("https://a.example/", "A", SyncedDevice("mac", "Mac", SyncedDevice.MAC, null, false, true))
                controller.stopSyncing()
            }
            assertTrue(device.threads.isNotEmpty())
            assertEquals(setOf(SyncController.THREAD_NAME), device.threads.toSet())
        } finally {
            controller.close()
        }
    }

    @Test
    fun theDemoControllerShowsTheDemoAndNeverSchedulesAnything() {
        val timers = ManualTimers()
        val background = RecordingScheduler()
        val controller = SyncController(DemoSyncDevice(timers.now), timers, background, inline)
        controller.start()
        controller.appForegrounded()
        val state = controller.state.value
        assertTrue(state.isDemo)
        assertEquals(SyncPhase.Updated, state.phase)
        assertEquals("Ardia Sync", state.folderName)
        assertEquals("Updated just now", state.words.rowSubtitle.text)
        assertEquals(2, controller.snapshot.value.profiles.size)
        assertEquals(ConnectResult.Connected, runBlocking { controller.connect("anything", SyncFolderPick.Tree("content://x")) })
        controller.localDidChange()
        assertTrue(runBlocking { controller.pinToMac("https://a.example/", "A") })
        assertFalse(runBlocking { controller.pinToMac("https://a.example/", "A", fromPrivateTab = true) })
        assertEquals(0, timers.waiting)
        assertEquals(listOf(false), background.updates)
    }

    private fun withTimeoutBlocking(block: suspend () -> Unit) = runBlocking { withTimeout(10_000) { block() } }
}
