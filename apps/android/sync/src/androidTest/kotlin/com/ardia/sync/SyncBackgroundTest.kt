package com.ardia.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.ardia.sync.core.FileKeyStore
import com.ardia.sync.core.RecoveryPhrase
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncBackgroundTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun startWorkManager() {
        if (!WorkManager.isInitialized()) WorkManager.initialize(context, Configuration.Builder().build())
    }

    private fun infos(name: String): List<WorkInfo> = WorkManager.getInstance(context).getWorkInfosForUniqueWork(name).get(10, TimeUnit.SECONDS)

    @Test
    fun syncingSchedulesOneRefreshEveryFifteenMinutesOnANetworkAndStoppingCancelsIt() {
        val scheduler = WorkManagerSyncScheduler(context)
        scheduler.update(true)
        scheduler.update(true)
        val scheduled = infos(WorkManagerSyncScheduler.PERIODIC_WORK).filter { it.state == WorkInfo.State.ENQUEUED }
        assertEquals(1, scheduled.size)
        val info = scheduled.single()
        assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
        assertTrue(info.constraints.requiresBatteryNotLow())
        assertEquals(TimeUnit.MINUTES.toMillis(15), info.periodicityInfo?.repeatIntervalMillis)
        scheduler.flushSoon()
        assertEquals(1, infos(WorkManagerSyncScheduler.FLUSH_WORK).count { it.state == WorkInfo.State.ENQUEUED })
        scheduler.update(false)
        assertTrue(infos(WorkManagerSyncScheduler.PERIODIC_WORK).all { it.state == WorkInfo.State.CANCELLED })
        assertTrue(infos(WorkManagerSyncScheduler.FLUSH_WORK).all { it.state == WorkInfo.State.CANCELLED })
    }

    @Test
    fun theControllerRunsTheServiceOffTheMainThreadAndABackgroundRunSyncs() {
        val sandbox = Sandbox()
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = FakeMac(sandbox.folder, entropy)
        mac.put("app", "dev:${mac.device}", """{"n":"MacBook Pro","k":"mac","f":["send"]}""")
        mac.put("app", "prof:${SyncEndToEndTest.PROFILE}", """{"n":"Personal","c":"blue","i":null,"d":true}""")
        mac.put(SyncEndToEndTest.SCOPE, "tabs:${mac.device}", """{"n":"MacBook Pro","tabs":[{"u":"https://news.example/","t":"News"}]}""")
        mac.sync(listOf("app", SyncEndToEndTest.SCOPE))
        val scheduler = RecordingWork()
        val controller = SyncController(
            makeDevice = { SyncService(sandbox.state, FileKeyStore(sandbox.keys), testAssets) },
            background = scheduler,
        )
        try {
            runBlocking {
                withTimeout(60_000) {
                    controller.start()
                    val result = controller.connect(RecoveryPhrase.words(entropy).joinToString(" "), SyncFolderPick.Folder(sandbox.root))
                    assertEquals(ConnectResult.Connected, result)
                    controller.syncNow()
                    assertEquals(SyncPhase.Updated, controller.state.value.phase)
                    assertEquals(listOf("MacBook Pro"), controller.receivers.value.map { it.name })
                    assertEquals("Personal", controller.selectedProfile.value?.name)
                    assertTrue(controller.backgroundCycle())
                    controller.stopSyncing()
                    assertEquals(SyncPhase.Off, controller.state.value.phase)
                }
            }
            assertEquals(listOf(false, true, false), scheduler.updates)
        } finally {
            controller.close()
            mac.close()
            sandbox.remove()
        }
    }

    private class RecordingWork : SyncBackgroundScheduler {
        val updates = ArrayList<Boolean>()

        override fun update(wanted: Boolean) {
            updates += wanted
        }

        override fun flushSoon() {}

        override fun flushDone() {}
    }
}
