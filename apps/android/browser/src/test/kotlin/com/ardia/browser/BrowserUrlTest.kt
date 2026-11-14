package com.ardia.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserUrlTest {
    @Test
    fun hostDropsWwwPortUserAndCase() {
        assertEquals("example.com", BrowserUrl.host("https://WWW.Example.com:8443/a?b#c"))
        assertEquals("example.com", BrowserUrl.host("https://user:pw@example.com/"))
        assertEquals("www.example.com", BrowserUrl.rawHost("https://www.example.com"))
        assertEquals("[::1]", BrowserUrl.host("http://[::1]:8080/"))
        assertEquals("example.com", BrowserUrl.host("https://example.com."))
    }

    @Test
    fun addressesWithoutAHostHaveNone() {
        assertNull(BrowserUrl.host("mailto:a@b.c"))
        assertNull(BrowserUrl.host("about:blank"))
        assertNull(BrowserUrl.host("https://"))
        assertNull(BrowserUrl.host("example.com"))
    }

    @Test
    fun schemeIsLowercasedAndValidated() {
        assertEquals("https", BrowserUrl.scheme("HTTPS://a"))
        assertEquals("google.navigation", BrowserUrl.scheme("google.navigation:q=x"))
        assertNull(BrowserUrl.scheme("1http://a"))
        assertNull(BrowserUrl.scheme(":nothing"))
        assertNull(BrowserUrl.scheme("two words:x"))
    }

    @Test
    fun pathStopsAtQueryAndFragment() {
        assertEquals("/store/apps/details", BrowserUrl.path("https://play.google.com/store/apps/details?id=x#y"))
        assertEquals("/", BrowserUrl.path("https://example.com"))
        assertEquals("/", BrowserUrl.path("https://example.com?q=1"))
        assertEquals("", BrowserUrl.path("tel:123"))
    }

    @Test
    fun fragmentsAndSchemesClassifyPages() {
        assertEquals("https://a.com/x", BrowserUrl.withoutFragment("https://a.com/x#top"))
        assertTrue(BrowserUrl.isSecure("https://a.com"))
        assertFalse(BrowserUrl.isSecure("http://a.com"))
        assertTrue(BrowserUrl.isWeb("http://a.com"))
        assertFalse(BrowserUrl.isWeb("ftp://a.com"))
        assertFalse(BrowserUrl.isWeb(null))
    }

    @Test
    fun securityFollowsSchemeAndMixedContent() {
        assertEquals(PageSecurity.Secure, PageSecurity.of("https://a.com", sawInsecureContent = false))
        assertEquals(PageSecurity.Mixed, PageSecurity.of("https://a.com", sawInsecureContent = true))
        assertEquals(PageSecurity.Insecure, PageSecurity.of("http://a.com", sawInsecureContent = false))
        assertEquals(PageSecurity.None, PageSecurity.of("about:blank", sawInsecureContent = false))
        assertEquals(PageSecurity.None, PageSecurity.of(null, sawInsecureContent = false))
    }

    @Test
    fun titlesThatAreJustTheAddressCountAsEmpty() {
        assertEquals("", WebViewPage.cleanTitle("127.0.0.1:8080/page.html", "http://127.0.0.1:8080/page.html"))
        assertEquals("", WebViewPage.cleanTitle("example.com", "https://example.com/"))
        assertEquals("", WebViewPage.cleanTitle("  ", "https://example.com/"))
        assertEquals("Real Title", WebViewPage.cleanTitle(" Real Title ", "https://example.com/"))
    }
}
