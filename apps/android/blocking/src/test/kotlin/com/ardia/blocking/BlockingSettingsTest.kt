package com.ardia.blocking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BlockingSettingsTest {
    @Test
    fun exemptionsPersistAndCoverSubdomains() {
        val store = InMemoryBlockingStore()
        val settings = BlockingSettings(store)
        assertTrue(settings.blocksAds && settings.blocksTrackers && settings.hidesCookieBanners)
        settings.setExempt("WWW.Example.com", true)
        settings.blocksTrackers = false
        val reloaded = BlockingSettings(store)
        assertEquals(setOf("example.com"), reloaded.exemptHosts)
        assertTrue(reloaded.isExempt("example.com"))
        assertTrue(reloaded.isExempt("news.example.com"))
        assertTrue(reloaded.isExempt("www.example.com"))
        assertFalse(reloaded.isExempt("notexample.com"))
        assertFalse(reloaded.isExempt("com"))
        assertFalse(reloaded.isEnabled(BlockingCategory.TRACKERS))
        assertEquals(reloaded.state.value.blocksTrackers, false)
        reloaded.setExempt("example.com", false)
        assertFalse(BlockingSettings(store).isExempt("news.example.com"))
    }

    @Test
    fun incognitoChangesStayInMemoryAndEndWithPrivateBrowsing() {
        val store = InMemoryBlockingStore()
        val blocking = BlockingSettings(store)
        blocking.setExempt("trusted.example", true)
        blocking.setExempt("secret.example", true, isPrivate = true)
        blocking.setExempt("trusted.example", false, isPrivate = true)
        assertTrue(blocking.isExempt("secret.example", isPrivate = true) && !blocking.isExempt("secret.example"))
        assertTrue(!blocking.isExempt("trusted.example", isPrivate = true) && blocking.isExempt("trusted.example"))
        assertEquals(setOf("trusted.example"), BlockingSettings(store).exemptHosts)
        blocking.endPrivateBrowsing()
        assertTrue(!blocking.isExempt("secret.example", isPrivate = true) && blocking.isExempt("trusted.example", isPrivate = true))
    }

    @Test
    fun theRequestPathSeesTheSameExemptionsAsTheSettings() {
        val settings = BlockingSettings(InMemoryBlockingStore())
        val lists = Fixture().use { it.lists() }
        val blocker = ContentBlocker(settings, lists)
        val ad = "https://securepubads.g.doubleclick.net/gpt.js"
        assertTrue(blocker.blocks(ad, "https://news.example.com/story", false))
        settings.setExempt("example.com", true)
        assertFalse(blocker.blocks(ad, "https://news.example.com/story", false))
        assertFalse(blocker.blocksAfterPrivateCheck(ad, "https://news.example.com/story", isPrivate = true))
        settings.setExempt("news.example.com", false, isPrivate = true)
        assertTrue(blocker.blocksAfterPrivateCheck(ad, "https://news.example.com/story", isPrivate = true))
        assertFalse(blocker.blocks(ad, "https://news.example.com/story", false))
        settings.endPrivateBrowsing()
        assertFalse(blocker.blocksAfterPrivateCheck(ad, "https://news.example.com/story", isPrivate = true))
        settings.setExempt("example.com", false)
        settings.blocksAds = false
        assertFalse(blocker.blocks(ad, "https://news.example.com/story", false))
        settings.blocksAds = true
        assertTrue(blocker.blocks(ad, "https://news.example.com/story", false))
    }

    private fun ContentBlocker.blocksAfterPrivateCheck(url: String, page: String, isPrivate: Boolean) =
        blocks(url, page, false, type = null, isPrivate = isPrivate)
}
