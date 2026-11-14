package com.ardia.phone

import com.ardia.sync.ReceivedTab
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneBrowsingSourceTest {
    private val now = 1_800_000_000_000L

    private fun inbox() = PhoneInbox(File(Files.createTempDirectory("phone-inbox").toFile().apply { deleteOnExit() }, "inbox.json"))

    @Test
    fun theSchemaIsTheKotlinStoresTablesPlusPreferences() {
        val statements = PhoneTestDatabase.schema()
        assertTrue(statements.any { it.startsWith("CREATE TABLE tabs (id TEXT PRIMARY KEY NOT NULL, url TEXT NOT NULL") })
        assertTrue(statements.any { it.startsWith("CREATE TABLE visits (id INTEGER PRIMARY KEY NOT NULL") })
        assertTrue(statements.any { it.startsWith("CREATE TABLE preferences") })
    }

    @Test
    fun openTabsAreTheThirtyNewestWebTabsOfEachProfile() {
        val file = PhoneTestDatabase.database { db ->
            repeat(35) { db.tab("t$it", "https://site$it.example/", now + it) }
            db.tab("blank", "about:blank", now + 100)
            db.tab("archived", "https://archived.example/", now + 200, archived = now)
            db.tab("work", "https://work.example/", now, profile = "work")
        }
        val tabs = PhoneBrowsingSource(JdbcRows(file), inbox()).syncedTabs()
        val personal = tabs.filter { it.profileSyncId == null }
        assertEquals(30, personal.size)
        assertEquals("https://site34.example/", personal.first().url)
        assertEquals("https://site5.example/", personal.last().url)
        assertEquals(listOf("https://work.example/"), tabs.filter { it.profileSyncId == "work" }.map { it.url })
        assertTrue(tabs.none { it.url == "about:blank" || it.url == "https://archived.example/" })
    }

    @Test
    fun visitsAreGroupedByAddressAndProfileAndHistoryTheMacRemovedIsLeftOut() {
        val file = PhoneTestDatabase.database { db ->
            db.visit("https://a.example/", now, title = "A")
            db.visit("https://a.example/", now + 10, title = "")
            db.visit("https://a.example/", now + 20, profile = "work")
            db.visit("https://b.example/", now + 30)
            db.visit("https://old.example/", now - 1000)
        }
        val inbox = inbox()
        val source = PhoneBrowsingSource(JdbcRows(file), inbox) { now + 60_000 }
        val visits = source.syncedVisits(now)
        assertEquals(3, visits.size)
        val a = visits.first { it.url == "https://a.example/" && it.profileSyncId == null }
        assertEquals(listOf(now, now + 10), a.visitedAt)
        assertEquals("A", a.title)
        source.removeVisits(setOf("https://a.example/"), null)
        assertTrue(source.syncedVisits(now).none { it.url == "https://a.example/" && it.profileSyncId == null })
        assertEquals(1, source.syncedVisits(now).count { it.url == "https://a.example/" })
        assertEquals(listOf("https://b.example/"), source.syncedVisits(setOf("https://b.example/", "https://a.example/")).filter { it.profileSyncId == null }.map { it.url })
        assertEquals(1, inbox.entries().size)
    }

    @Test
    fun receivedTabsWaitInTheInboxOnceUntilTheAppAppliesThem() {
        val file = PhoneTestDatabase.database { }
        val inbox = inbox()
        val source = PhoneBrowsingSource(JdbcRows(file), inbox)
        val tab = ReceivedTab("k1", "https://sent.example/", "Sent", "MacBook", now, "p1", "mac1")
        assertTrue(source.receive(listOf(tab, tab.copy(key = "k2", url = "javascript:alert(1)"))))
        assertTrue(source.receive(listOf(tab)))
        assertEquals(listOf(listOf("k1")), inbox.entries().map { entry -> entry.received.map { it.key } })
        inbox.applied(inbox.entries().map { it.id }.toSet())
        assertTrue(inbox.entries().isEmpty())
    }

    @Test
    fun aPhoneThatHasNotMadeItsDatabaseSyncsNothingAndAnUnreadableOneFailsTheCycle() {
        val missing = File(Files.createTempDirectory("phone-missing").toFile(), "browser.db")
        assertTrue(PhoneBrowsingSource(JdbcRows(missing), inbox()).syncedTabs().isEmpty())
        val broken = File(Files.createTempDirectory("phone-broken").toFile(), "browser.db").apply { writeText("not a database") }
        val failed = runCatching { PhoneBrowsingSource(JdbcRows(broken), inbox()).syncedTabs() }
        assertTrue(failed.isFailure)
    }
}
