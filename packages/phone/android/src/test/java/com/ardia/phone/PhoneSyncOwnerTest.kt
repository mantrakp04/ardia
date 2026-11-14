package com.ardia.phone

import android.content.Context
import android.content.ContextWrapper
import com.ardia.sync.FakeDevice
import com.ardia.sync.LocalBrowsingSource
import com.ardia.sync.ManualTimers
import com.ardia.sync.RecordingScheduler
import com.ardia.sync.SyncController
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneSyncOwnerTest {
    private val root = Files.createTempDirectory("phone-owner").toFile().apply { deleteOnExit() }

    private val app: Context = object : ContextWrapper(null) {
        override fun getApplicationContext(): Context = this

        override fun getFilesDir(): File = File(root, "files").apply { mkdirs() }

        override fun getNoBackupFilesDir(): File = File(root, "no_backup").apply { mkdirs() }
    }

    @After
    fun forget() = PhoneSync.forgetForTests()

    @Test
    fun aControllerMadeBeforeReactNativeStartsReadsThePhonesDatabaseAndHasTheInbox() {
        PhoneTestDatabase.create(File(app.filesDir, "SQLite/browser.db")) { db ->
            db.tab("t1", "https://first.example/", 10)
            db.visit("https://first.example/", 10)
        }
        var given: LocalBrowsingSource? = null
        val device = FakeDevice()
        PhoneSync.makeRows = ::JdbcRows
        PhoneSync.makeController = { _, source ->
            given = source
            SyncController(device, ManualTimers(), RecordingScheduler()).also { it.source = source }
        }
        val controller = PhoneSync.controller(app)
        assertSame(controller, PhoneSync.controller(app))
        val source = given!!
        assertEquals(listOf("https://first.example/"), source.syncedTabs().map { it.url })
        assertEquals(listOf("https://first.example/"), source.syncedVisits(0).map { it.url })
        source.removeVisits(setOf("https://first.example/"), null)
        assertTrue(File(app.noBackupFilesDir, "PhoneSync/inbox.json").isFile)
        assertEquals(1, PhoneSync.inbox(app).entries().size)
        PhoneTestWaits.until { device.source === source }
    }
}
