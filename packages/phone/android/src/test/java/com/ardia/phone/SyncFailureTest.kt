package com.ardia.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncFailureTest {
    private val denial = SecurityException("Permission Denial: reading com.android.externalstorage.ExternalStorageProvider uri content://com.android.externalstorage.documents/tree/primary%3AArdia%20Sync requires that you obtain access")

    @Test
    fun aStoreBuildTellsTheScreensThatConnectingFailedWithoutTheFolderOrTheCause() {
        val failure = SyncFailure.forScript(denial, lab = false)
        assertEquals("ERR_SYNC", failure.code)
        assertFalse(failure.message.orEmpty().contains("content://"))
        assertFalse(failure.message.orEmpty().contains("Ardia"))
        assertNull(failure.cause)
    }

    @Test
    fun aLabBuildKeepsTheWholeMessage() {
        val failure = SyncFailure.forScript(denial, lab = true)
        assertTrue(failure.message.orEmpty().contains("content://"))
        assertEquals(denial, failure.cause)
    }
}
