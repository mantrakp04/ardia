package com.ardia.phone

import com.ardia.sync.HistoryRemoval
import com.ardia.sync.ReceivedTab
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneInboxTest {
    private val directory = Files.createTempDirectory("phone-inbox").toFile().apply { deleteOnExit() }
    private val file = File(directory, "inbox.json")

    private fun tab(key: String, at: Long = 1L) = ReceivedTab(key, "https://$key.example/", key, "MacBook", at, "p1", "mac1")

    private fun removal(vararg urls: String, profile: String? = null) = HistoryRemoval(profile, urls.toSet())

    private fun aside(): List<File> = directory.listFiles()!!.filter { it.name.startsWith("inbox.json.unreadable-") }

    private fun pendingUrls(inbox: PhoneInbox) = inbox.entries().flatMap { entry -> entry.removals.flatMap { it.urls } }.sorted()

    @Test
    fun aTruncatedFileIsSetAsideKeptAndTheWriteThatFoundItFails() {
        val truncated = """[{"id":1,"received":[],"removals":[{"profileSyncId":null,"urls":["https://gone.example/"""
        file.writeText(truncated)
        val inbox = PhoneInbox(file)
        assertFalse("the write that found the damage must fail", inbox.remove(removal("https://new.example/")))
        assertEquals(listOf(truncated), aside().map { it.readText() })
        assertNotNull(inbox.problem)
        assertTrue(inbox.remove(removal("https://new.example/")))
        assertEquals(listOf("https://new.example/"), pendingUrls(inbox))
        assertEquals(1, aside().size)
    }

    @Test
    fun anEmptyFileIsSetAsideToo() {
        file.writeText("")
        val inbox = PhoneInbox(file)
        assertFalse(inbox.receive(listOf(tab("k1"))))
        assertEquals(1, aside().size)
        assertNotNull(inbox.problem)
    }

    @Test
    fun oneEntryWithABadFieldIsSetAsideAndTheOthersAreKept() {
        file.writeText(
            """{"v":2,"entries":[
              {"id":1,"received":[],"removals":[{"profileSyncId":null,"urls":["https://kept.example/"],"includesUnassigned":false}]},
              {"id":2,"received":[{"key":"k1","url":42}],"removals":[]},
              {"id":3,"received":[{"key":"k3","url":"https://k3.example/","title":"K3","fromDevice":"Mac","fromDeviceId":"m","sentAt":5,"profileSyncId":"p1"}],"removals":[]}
            ],"applied":[]}""",
        )
        val inbox = PhoneInbox(file)
        assertEquals(listOf("https://kept.example/"), pendingUrls(inbox))
        assertEquals(listOf("k3"), inbox.entries().flatMap { entry -> entry.received.map { it.key } })
        assertTrue(aside().single().readText().contains("\"k1\""))
        assertNotNull(inbox.problem)
    }

    @Test
    fun aKillBetweenTheStagingWriteAndTheRenameKeepsTheLastWholeFile() {
        val first = PhoneInbox(file)
        assertTrue(first.remove(removal("https://whole.example/")))
        File(directory, ".inbox.json.partial").writeText("""{"v":2,"entries":[{"id":9""")
        val restarted = PhoneInbox(file)
        assertEquals(listOf("https://whole.example/"), pendingUrls(restarted))
        assertFalse(File(directory, ".inbox.json.partial").exists())
        assertNull(restarted.problem)
        assertTrue(aside().isEmpty())
    }

    @Test
    fun removalsAreKeptOnceEachAndNeverDropped() {
        val inbox = PhoneInbox(file)
        assertTrue(inbox.remove(removal("https://a.example/", "https://b.example/")))
        assertTrue(inbox.remove(removal("https://b.example/", "https://c.example/")))
        assertTrue(inbox.remove(removal("https://a.example/")))
        assertEquals(listOf("https://a.example/", "https://b.example/", "https://c.example/"), pendingUrls(inbox))
        assertTrue(inbox.remove(removal("https://a.example/", profile = "work")))
        assertEquals(4, inbox.entries().flatMap { it.removals }.sumOf { it.urls.size })
        val many = (0 until 5_000).map { "https://many$it.example/" }
        for (chunk in many.chunked(250)) assertTrue(inbox.remove(HistoryRemoval(null, chunk.toSet())))
        assertEquals(5_004, PhoneInbox(file).entries().flatMap { it.removals }.sumOf { it.urls.size })
    }

    @Test
    fun writesBeforeTheAppReadsAreOneEntryAndLaterOnesAreNew() {
        val inbox = PhoneInbox(file)
        inbox.receive(listOf(tab("k1")))
        inbox.remove(removal("https://a.example/"))
        inbox.receive(listOf(tab("k2")))
        val read = inbox.entries()
        assertEquals(1, read.size)
        inbox.receive(listOf(tab("k3")))
        assertEquals(2, inbox.entries().size)
        inbox.applied(read.map { it.id }.toSet())
        assertEquals(listOf("k3"), inbox.entries().flatMap { entry -> entry.received.map { it.key } })
    }

    @Test
    fun sentTabsAreCappedOldestFirst() {
        val inbox = PhoneInbox(file)
        for (index in 0 until PhoneInbox.RECEIVED_LIMIT + 50) {
            assertTrue(inbox.receive(listOf(tab("k$index", at = index.toLong()))))
            if (index % 7 == 0) inbox.entries()
        }
        val kept = inbox.entries().flatMap { entry -> entry.received.map { it.key } }
        assertEquals(PhoneInbox.RECEIVED_LIMIT, kept.size)
        assertFalse("k0" in kept)
        assertTrue("k${PhoneInbox.RECEIVED_LIMIT + 49}" in kept)
    }

    @Test
    fun aReplayAfterTheAppAppliedButBeforeItSaidSoIsIdempotent() {
        val inbox = PhoneInbox(file)
        assertTrue(inbox.receive(listOf(tab("k1"))))
        assertTrue(inbox.remove(removal("https://a.example/")))
        val read = inbox.entries()
        val restarted = PhoneInbox(file)
        assertTrue(restarted.receive(listOf(tab("k1"))))
        assertTrue(restarted.remove(removal("https://a.example/")))
        assertEquals(read.map { it.id }, restarted.entries().map { it.id })
        assertEquals(listOf("k1"), restarted.entries().flatMap { entry -> entry.received.map { it.key } })
        restarted.applied(read.map { it.id }.toSet())
        assertTrue(restarted.entries().isEmpty())
        assertTrue(restarted.receive(listOf(tab("k1"))))
        assertTrue("a tab already applied is not delivered again", PhoneInbox(file).entries().isEmpty())
    }

    @Test
    fun theLabCanDamageAnInboxItAlreadyReadSoTheNextReadSetsItAside() {
        val inbox = PhoneInbox(file)
        assertTrue(inbox.receive(listOf(tab("a"))))
        assertEquals(1, inbox.entries().size)
        inbox.damageForLab()
        assertEquals(emptyList<PhoneInbox.Entry>(), inbox.entries())
        assertEquals(1, aside().size)
        assertTrue(inbox.problem != null)
    }
}
