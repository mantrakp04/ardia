package com.ardia.phone

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhoneAppLinksTest {
    private fun preferences() = PhoneSitePreferences(RuntimeEnvironment.getApplication().getSharedPreferences("app-links-test", Context.MODE_PRIVATE).apply { edit().clear().commit() })

    @Test
    fun sitesFollowTheGlobalChoiceUnlessTheyHaveTheirOwn() {
        val sites = preferences()
        assertFalse(sites.defaultOpensLinksInApps)
        assertFalse(sites.opensLinksInApps("youtube.com", false))
        sites.defaultOpensLinksInApps = true
        assertTrue(sites.opensLinksInApps("youtube.com", false))
        sites.setOpensLinksInApps("youtube.com", false)
        assertFalse(sites.opensLinksInApps("youtube.com", false))
        assertEquals(false, sites.siteOpensLinksInApps("youtube.com"))
        assertTrue(sites.opensLinksInApps("maps.example", false))
        sites.setOpensLinksInApps("youtube.com", null)
        assertNull(sites.siteOpensLinksInApps("youtube.com"))
        assertTrue(sites.opensLinksInApps("youtube.com", false))
        sites.defaultOpensLinksInApps = false
        sites.setOpensLinksInApps("www.youtube.com", true)
        assertTrue(sites.opensLinksInApps("youtube.com", false))
        assertFalse(sites.opensLinksInApps(null, false))
    }
}
