package com.ardia.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanAccessTest {
    @Test
    fun aPermissionThatIsOnlyNotGrantedIsUndeterminedSoTheScreenAsks() {
        assertEquals(ScanAccess.Answer("granted", true), ScanAccess.status(granted = true, rationale = false, deniedForGood = false))
        assertEquals(ScanAccess.Answer("undetermined", true), ScanAccess.status(granted = false, rationale = false, deniedForGood = false))
        assertEquals(ScanAccess.Answer("denied", true), ScanAccess.status(granted = false, rationale = true, deniedForGood = false))
        assertEquals(ScanAccess.Answer("denied", false), ScanAccess.status(granted = false, rationale = false, deniedForGood = true))
        assertEquals(ScanAccess.Answer("denied", true), ScanAccess.status(granted = false, rationale = true, deniedForGood = true))
    }

    @Test
    fun onlyARefusedRequestWithNoRationaleCountsAsDeniedForGood() {
        assertFalse(ScanAccess.deniedForGoodAfterAsking(granted = true, rationale = false))
        assertFalse(ScanAccess.deniedForGoodAfterAsking(granted = false, rationale = true))
        assertTrue(ScanAccess.deniedForGoodAfterAsking(granted = false, rationale = false))
    }
}
