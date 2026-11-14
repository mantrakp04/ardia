package com.ardia.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PageSetupTest {
    @Test
    fun aSetupRestoresUnlessItSaysItIsAFreshOpen() {
        assertEquals(VisitKind.Restored, PageSetup(url = "https://example.com/").firstVisit)
        val typed = PageSetup.fresh("https://example.com/", VisitKind.Typed, isPrivate = true)
        assertEquals(VisitKind.Typed, typed.firstVisit)
        assertEquals(true, typed.isPrivate)
        assertNotEquals(PageSetup(url = "https://example.com/", isPrivate = true), typed)
        assertEquals(PageSetup.fresh("https://example.com/", VisitKind.Typed, isPrivate = true), typed)
    }
}
