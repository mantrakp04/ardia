package com.ardia.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnlineAgainTest {
    @Test
    fun onlyANetworkAfterBeingOfflineCountsAndOnlyOnce() {
        val online = OnlineAgain(startedOffline = false)
        assertFalse(online.available())
        online.lost()
        assertTrue(online.available())
        assertFalse(online.available())
        val offline = OnlineAgain(startedOffline = true)
        assertTrue(offline.available())
        assertFalse(offline.available())
    }
}
