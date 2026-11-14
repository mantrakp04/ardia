package com.ardia.sync.core

import java.io.File
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SyncKeysTest {
    private val keys = SyncKeys(RecoveryPhrase.generateEntropy())

    @Test
    fun theFormatIsUnchanged() {
        val zero = SyncKeys(ByteArray(32))
        assertEquals("gbcx4r55mk3rlaegbggknyx4ta", zero.chainTag)
        assertEquals("nr4ncp5iyqzqgjn6ol4zksqtne", zero.scopeTag("app"))
        val fixtures = File(System.getProperty("ardia.syncFixtures") ?: error("ardia.syncFixtures isn't set"))
        val sealed = Base64.getDecoder().decode(File(fixtures, "sealed-0.2.32.b64").readText().trim())
        assertArrayEquals("from 0.2.32".toByteArray(), zero.open(sealed, zero.scopeTag("app"), "f1"))
    }

    @Test
    fun sealedFilesArePaddedToKilobytes() {
        for (size in listOf(0, 1, 1019, 1020, 1021, 5000)) {
            val sealed = keys.seal(ByteArray(size) { 7 }, "s", "f")
            assertEquals(0, (sealed.size - 4 - 12 - 16) % 1024)
            assertEquals(size, keys.open(sealed, "s", "f").size)
        }
    }

    @Test
    fun tamperingIsDetected() {
        val sealed = keys.seal("bookmark".toByteArray(), "s", "f")
        for (index in listOf(4, 10, 16, 40, sealed.size - 1)) {
            val bad = sealed.copyOf()
            bad[index] = (bad[index].toInt() xor 1).toByte()
            assertEquals(SyncKeys.Failure.Authentication, assertThrows(SyncKeys.Failure::class.java) { keys.open(bad, "s", "f") })
        }
        assertThrows(SyncKeys.Failure::class.java) { keys.open(sealed.copyOf(sealed.size / 2), "s", "f") }
        assertEquals(SyncKeys.Failure.Format, assertThrows(SyncKeys.Failure::class.java) { keys.open(sealed.copyOf(10), "s", "f") })
        assertEquals(SyncKeys.Failure.Format, assertThrows(SyncKeys.Failure::class.java) { keys.open(ByteArray(0), "s", "f") })
        assertEquals(SyncKeys.Failure.Authentication, assertThrows(SyncKeys.Failure::class.java) { keys.open(sealed, "s", "g") })
        assertEquals(SyncKeys.Failure.Authentication, assertThrows(SyncKeys.Failure::class.java) { keys.open(sealed, "t", "f") })
    }

    @Test
    fun aWrongPhraseCantOpen() {
        val sealed = keys.seal("bookmark".toByteArray(), "s", "f")
        val other = SyncKeys(RecoveryPhrase.generateEntropy())
        assertThrows(SyncKeys.Failure.Authentication::class.java) { other.open(sealed, "s", "f") }
        assertNotEquals(other.chainTag, keys.chainTag)
    }

    @Test
    fun passwordsAreDeterministicAndBound() {
        val sealed = keys.sealPassword("hunter2", "https://bank.example", "luke")
        assertEquals(sealed, keys.sealPassword("hunter2", "https://bank.example", "luke"))
        assertEquals("hunter2", keys.openPassword(sealed, "https://bank.example", "luke"))
        assertThrows(SyncKeys.Failure::class.java) { keys.openPassword(sealed, "https://bank.example", "leia") }
    }

    @Test
    fun fileIdsAreTags() {
        repeat(20) { assertEquals(true, Base32.isTag(SyncKeys.newFileId())) }
    }
}
