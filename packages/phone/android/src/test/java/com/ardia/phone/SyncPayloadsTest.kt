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
}
