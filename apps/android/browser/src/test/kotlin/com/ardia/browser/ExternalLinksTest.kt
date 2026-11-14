package com.ardia.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalLinksTest {
    @Test
    fun webSchemesStayInThePage() {
        for (url in listOf("https://example.com", "http://example.com/a", "about:blank", "data:text/html,hi", "blob:https://x/1", "ardia://start")) {
            assertEquals(url, LinkRoute.Web, ExternalLinks.route(url))
        }
    }

    @Test
    fun scriptSchemesAreBlockedInTheMainFrameOnly() {
        assertEquals(LinkRoute.Blocked, ExternalLinks.route("javascript:alert(1)"))
        assertEquals(LinkRoute.Blocked, ExternalLinks.route("VBScript:x"))
        assertEquals(LinkRoute.Web, ExternalLinks.route("javascript:void(0)", isMainFrame = false))
    }

    @Test
    fun knownSchemesNameTheirApp() {
        assertEquals(LinkRoute.External(ExternalApp.Phone), ExternalLinks.route("tel:+15551234"))
        assertEquals(LinkRoute.External(ExternalApp.Email), ExternalLinks.route("mailto:a@b.c"))
        assertEquals(LinkRoute.External(ExternalApp.Messages), ExternalLinks.route("sms:+1555"))
        assertEquals(LinkRoute.External(ExternalApp.Messages), ExternalLinks.route("smsto:+1555"))
        assertEquals(LinkRoute.External(ExternalApp.Maps), ExternalLinks.route("geo:0,0?q=Lisbon"))
        assertEquals(LinkRoute.External(ExternalApp.Store), ExternalLinks.route("market://details?id=com.x"))
    }

    @Test
    fun playStorePagesOpenTheStoreOnlyFromTheMainFrame() {
        val url = "https://play.google.com/store/apps/details?id=com.example"
        assertEquals(LinkRoute.External(ExternalApp.Store), ExternalLinks.route(url))
        assertEquals(LinkRoute.Web, ExternalLinks.route(url, isMainFrame = false))
        assertEquals(LinkRoute.Web, ExternalLinks.route("https://play.google.com/store/books"))
    }

    @Test
    fun unknownSchemesAskInTheMainFrameAndAreBlockedInFrames() {
        assertEquals(LinkRoute.External(ExternalApp.Other), ExternalLinks.route("spotify:track:1"))
        assertEquals(LinkRoute.Blocked, ExternalLinks.route("spotify:track:1", isMainFrame = false))
        assertEquals(LinkRoute.Blocked, ExternalLinks.route("no scheme here"))
    }

    @Test
    fun intentLinksKeepTheirWebFallback() {
        val url = "intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;" +
            "S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fscan%3Fa%3D1;end"
        val link = ExternalLinks.parseIntent(url)!!
        assertEquals("zxing", link.scheme)
        assertEquals("com.google.zxing.client.android", link.packageName)
        assertEquals("https://example.com/scan?a=1", link.fallbackUrl)
        assertEquals(LinkRoute.External(ExternalApp.Other, "https://example.com/scan?a=1"), ExternalLinks.route(url))
    }

    @Test
    fun intentFallbacksThatAreNotWebAddressesAreDropped() {
        val url = "intent://x#Intent;scheme=foo;S.browser_fallback_url=javascript%3Aalert(1);end"
        assertNull(ExternalLinks.parseIntent(url)!!.fallbackUrl)
        assertEquals(LinkRoute.Blocked, ExternalLinks.route(url, isMainFrame = false))
    }

    @Test
    fun storeIntentsNameTheStore() {
        val url = "intent://details?id=com.x#Intent;scheme=market;package=com.android.vending;end"
        assertEquals(LinkRoute.External(ExternalApp.Store), ExternalLinks.route(url))
    }

    @Test
    fun framesAskOnlyAfterATap() {
        assertTrue(ExternalLinks.asksBeforeOpening(isMainFrame = true, hasGesture = false))
        assertTrue(ExternalLinks.asksBeforeOpening(isMainFrame = false, hasGesture = true))
        assertFalse(ExternalLinks.asksBeforeOpening(isMainFrame = false, hasGesture = false))
    }
}
