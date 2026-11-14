package com.ardia.phone

import com.ardia.sync.SyncController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SyncPayloadsTest {
    @Test
    fun theViewSaysWhichProfileIsShownBeforeAnyIsPickedAndAfter() {
        val demo = SyncController.demo().apply { start() }
        try {
            PhoneTestWaits.until { demo.snapshot.value.profiles.size > 1 }
            val snapshot = demo.snapshot.value
            val default = snapshot.profiles.first { it.isDefault }
            val other = snapshot.profiles.first { !it.isDefault }
            assertEquals(default.syncId, SyncPayloads.view(snapshot, null, emptyList())["shownProfileId"])
            assertEquals(other.syncId, SyncPayloads.view(snapshot, other.syncId, emptyList())["shownProfileId"])
            assertEquals(default.syncId, SyncPayloads.view(snapshot, "gone", emptyList())["shownProfileId"])
            assertNull(SyncPayloads.view(com.ardia.sync.SyncSnapshot.empty, null, emptyList())["shownProfileId"])
        } finally {
            demo.close()
        }
    }

    @Test
    fun aStalledStatusSaysHowLongAgoAtTheMomentItIsSentNotWhenItWasMade() {
        val synced = 1_800_000_000_000L
        val stalled = com.ardia.sync.SyncState(
            phase = com.ardia.sync.SyncPhase.Stalled("x"),
            statusText = com.ardia.sync.SyncStatusText.of(com.ardia.sync.SyncPhase.Stalled("x"), synced, 0, synced + 5_000),
            isEnabled = true,
            lastSynced = synced,
        )
        assertEquals("Not syncing · Last synced 3 minutes ago", SyncPayloads.status(stalled, null, now = synced + 3 * 60_000 + 10_000)["statusText"])
        val updated = stalled.copy(phase = com.ardia.sync.SyncPhase.Updated, statusText = "Updated just now")
        assertEquals("Updated just now", SyncPayloads.status(updated, null, now = synced + 3 * 60_000)["statusText"])
        assertEquals(true, SyncPayloads.wordsAge(stalled))
        assertEquals(false, SyncPayloads.wordsAge(updated))
    }
}
