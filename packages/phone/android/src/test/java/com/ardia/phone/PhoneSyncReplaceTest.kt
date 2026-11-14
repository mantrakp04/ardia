package com.ardia.phone

import android.content.Context
import android.content.ContextWrapper
import com.ardia.sync.FakeDevice
import com.ardia.sync.ManualTimers
import com.ardia.sync.RecordingScheduler
import com.ardia.sync.SyncController
import com.ardia.sync.SyncDevice
import java.io.File
import java.nio.file.Files
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneSyncReplaceTest {
    private val root = Files.createTempDirectory("phone-replace").toFile().apply { deleteOnExit() }

    private val app: Context = object : ContextWrapper(null) {
        override fun getApplicationContext(): Context = this

        override fun getFilesDir(): File = File(root, "files").apply { mkdirs() }

        override fun getNoBackupFilesDir(): File = File(root, "no_backup").apply { mkdirs() }
    }

    private class Logged(private val inner: FakeDevice, private val name: String, private val log: MutableList<String>) : SyncDevice by inner {
        override fun start() {
            log += "$name start"
            inner.start()
        }

        override fun close() {
            log += "$name close"
            inner.close()
        }
    }

    @After
    fun forget() = PhoneSync.forgetForTests()

    @Test
    fun aReplacementStartsOnlyAfterTheEngineItReplacesHasClosedEvenMidCycle() {
        val log = Collections.synchronizedList(ArrayList<String>())
        val inCycle = CountDownLatch(1)
        val release = CountDownLatch(1)
        val first = FakeDevice().apply {
            duringSync = {
                inCycle.countDown()
                release.await(5, TimeUnit.SECONDS)
            }
        }
        PhoneSync.labBuild = true
        PhoneSync.makeRows = ::JdbcRows
        PhoneSync.makeDemo = { SyncController(Logged(first, "demo", log), ManualTimers(), RecordingScheduler()) }
        PhoneSync.makeController = { _, _ -> SyncController(Logged(FakeDevice(), "real", log), ManualTimers(), RecordingScheduler()) }
        val demo = PhoneSync.controller(app, demo = true)
        val cycle = thread { runBlocking { runCatching { demo.syncNow() } } }
        assertTrue(inCycle.await(5, TimeUnit.SECONDS))
        thread {
            Thread.sleep(300)
            release.countDown()
        }
        val real = PhoneSync.controller(app, demo = false)
        PhoneTestWaits.until { "real start" in log }
        cycle.join(5_000)
        val order = log.toList()
        assertTrue("the old engine closed before the new one started: $order", order.indexOf("demo close") in 0 until order.indexOf("real start"))
        assertEquals(real, PhoneSync.current())
    }
}
