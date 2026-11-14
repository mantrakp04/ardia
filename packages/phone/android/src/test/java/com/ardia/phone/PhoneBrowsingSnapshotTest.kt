package com.ardia.phone

import java.io.File
import java.nio.file.Files
import java.sql.DriverManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneBrowsingSnapshotTest {
    private val now = 1_800_000_000_000L

    private fun inbox() = PhoneInbox(File(Files.createTempDirectory("phone-inbox").toFile().apply { deleteOnExit() }, "inbox.json"))

    private fun other(file: File, work: (java.sql.Connection) -> Unit) = DriverManager.getConnection("jdbc:sqlite:${file.path}").use(work)

    private fun PhoneBrowsingSource.cycle() = readingTogether { syncedVisits(now - 1_000).map { it.url }.sorted() to syncedTabs().map { it.url }.sorted() }

    @Test
    fun aDatabaseFromANewerAppFailsTheReadInsteadOfGuessingItsTables() {
        val file = PhoneTestDatabase.create(File(Files.createTempDirectory("phone-newer").toFile(), "browser.db"), version = 2) { db ->
            db.tab("a", "https://a.example/", now)
        }
        val source = PhoneBrowsingSource(JdbcRows(file), inbox(), clock = { now })
        assertThrows(IllegalStateException::class.java) { source.syncedTabs() }
        assertThrows(IllegalStateException::class.java) { source.cycle() }
    }

    @Test
    fun aWriteBetweenTheReadsOfOneCycleIsReadAgainSoTabsAndVisitsAgree() {
        val file = PhoneTestDatabase.database { db ->
            db.tab("a", "https://a.example/", now)
            db.visit("https://a.example/", now)
        }
        var written = false
        val rows = JdbcRows(file) { sql ->
            if (!written && "FROM tabs" in sql) {
                written = true
                other(file) { db ->
                    db.tab("b", "https://b.example/", now + 1)
                    db.visit("https://b.example/", now + 1)
                }
            }
        }
        val (visits, tabs) = PhoneBrowsingSource(rows, inbox(), clock = { now }).cycle()
        assertTrue(written)
        assertEquals(tabs, visits)
        assertEquals(listOf("https://a.example/", "https://b.example/"), tabs)
    }

    @Test
    fun aCheckpointDuringTheReadsChangesNothing() {
        val file = PhoneTestDatabase.database { db ->
            db.tab("a", "https://a.example/", now)
            db.visit("https://a.example/", now)
        }
        other(file) { db ->
            db.tab("b", "https://b.example/", now + 1)
            db.visit("https://b.example/", now + 1)
        }
        var checkpointed = false
        val rows = JdbcRows(file) { sql ->
            if (!checkpointed && "FROM tabs" in sql) {
                checkpointed = true
                other(file) { db -> db.createStatement().use { it.execute("PRAGMA wal_checkpoint(TRUNCATE)") } }
            }
        }
        val (visits, tabs) = PhoneBrowsingSource(rows, inbox(), clock = { now }).cycle()
        assertTrue(checkpointed)
        assertEquals(listOf("https://a.example/", "https://b.example/"), tabs)
        assertEquals(tabs, visits)
    }
}
