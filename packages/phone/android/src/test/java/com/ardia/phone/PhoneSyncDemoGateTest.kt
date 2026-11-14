package com.ardia.phone

import android.content.Context
import android.content.ContextWrapper
import com.ardia.sync.FakeDevice
import com.ardia.sync.ManualTimers
import com.ardia.sync.RecordingScheduler
import com.ardia.sync.SyncController
import java.io.File
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PhoneSyncDemoGateTest {
    private val root = Files.createTempDirectory("phone-demo-gate").toFile().apply { deleteOnExit() }
    private val demosMade = AtomicInteger()

    private val app: Context = object : ContextWrapper(null) {
        override fun getApplicationContext(): Context = this

        override fun getFilesDir(): File = File(root, "files").apply { mkdirs() }

        override fun getNoBackupFilesDir(): File = File(root, "no_backup").apply { mkdirs() }
    }

    private fun real(enabled: Boolean) {
        PhoneSync.makeController = { _, _ -> SyncController(FakeDevice(enabledOnStart = enabled), ManualTimers(), RecordingScheduler()) }
    }

    @Before
    fun fakes() {
        PhoneSync.makeRows = ::JdbcRows
        PhoneSync.makeDemo = {
            demosMade.incrementAndGet()
            SyncController.demo()
        }
    }

    @After
    fun forget() = PhoneSync.forgetForTests()

    @Test
    fun aBuildWithoutTheLabSwitchNeverMakesTheDemo() {
        PhoneSync.labBuild = false
        real(enabled = false)
        val sync = PhoneSync.controller(app, demo = true)
        assertFalse(PhoneSync.isDemo)
        assertEquals(0, demosMade.get())
        assertSame(sync, PhoneSync.controller(app, demo = true))
    }

    @Test
    fun theDemoNeverReplacesARunningControllerThatIsConnected() {
        PhoneSync.labBuild = true
        real(enabled = true)
        val sync = PhoneSync.controller(app)
        PhoneTestWaits.until { sync.state.value.isEnabled }
        assertSame(sync, PhoneSync.controller(app, demo = true))
        assertFalse(PhoneSync.isDemo)
        assertEquals(0, demosMade.get())
    }

    @Test
    fun theDemoIsRefusedWhenSyncIsSetUpOnDiskEvenBeforeAControllerExists() {
        PhoneSync.labBuild = true
        real(enabled = false)
        File(app.noBackupFilesDir, "Sync").apply { mkdirs() }.resolve("sync.json").writeText("""{"deviceId":"phone-1","enabled":true}""")
        PhoneSync.controller(app, demo = true)
        assertFalse(PhoneSync.isDemo)
        assertEquals(0, demosMade.get())
    }

    @Test
    fun theLabBuildStillOpensTheDemoWhenNothingIsConnected() {
        PhoneSync.labBuild = true
        real(enabled = false)
        PhoneSync.controller(app, demo = true)
        assertTrue(PhoneSync.isDemo)
        assertEquals(1, demosMade.get())
    }
}
