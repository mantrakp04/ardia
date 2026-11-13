package com.ardia.appmodel

import com.ardia.design.Motion
import com.ardia.store.BrowserTab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LaunchAndPagerTest {
    @Test
    fun launchArgumentsParseTheIphoneNamesFromExtrasOfAnyType() {
        val launch = LaunchArguments.parse(
            mapOf(
                "ArdiaDemo" to "YES",
                "BrowseQuery" to "pastéis de nata",
                "BrowseSurface" to "browsing",
                "BrowseTab" to 3,
                "BrowseToolbar" to true,
                "BrowseReader" to "1",
                "BrowseIncognito" to false,
                "BrowseDelay" to "2.5",
                "ArdiaDeck" to "deck,wait:1,close",
                "ArdiaOnboarding" to "YES",
                "ArdiaOpenSheet" to "spaces",
                "BrowsePlus" to true,
                "BrowseOverlay" to "wiki",
                "ArdiaRestingStart" to true,
                "BrowsePagerFreeze" to "-0.4",
                "BrowsePagerScript" to true,
                "BrowseLoadFreeze" to 0.6,
                "BrowseSteps" to "1, -1,x,2",
            ),
        )
        assertTrue(launch.isDemo)
        assertEquals("pastéis de nata", launch.browseQuery)
        assertEquals("browsing", launch.browseSurface)
        assertEquals(3, launch.browseTab)
        assertTrue(launch.browseToolbar)
        assertTrue(launch.browseReader)
        assertFalse(launch.browseIncognito)
        assertEquals(2_500L, launch.browseDelayMillis)
        assertEquals("deck,wait:1,close", launch.deckScript)
        assertTrue(launch.showsOnboarding)
        assertEquals("spaces", launch.openSheet)
        assertTrue(launch.browsePlus)
        assertEquals("wiki", launch.browseOverlay)
        assertTrue(launch.restingStart)
        assertEquals(-0.4, launch.pagerFreeze!!, 0.0)
        assertTrue(launch.pagerScript)
        assertEquals(0.6, launch.loadFreeze!!, 0.0)
        assertEquals(listOf(1, -1, 2), launch.browseSteps)
    }

    @Test
    fun motionCaptureArgumentsOnlyCountInDemoModeAndDefaultsHold() {
        val launch = LaunchArguments.parse(mapOf("BrowsePagerFreeze" to "0.5", "BrowsePagerScript" to true, "ArdiaDemo" to "NO"))
        assertFalse(launch.isDemo)
        assertNull(launch.pagerFreeze)
        assertFalse(launch.pagerScript)
        assertEquals(6_000L, launch.browseDelayMillis)
        assertEquals(LaunchArguments.none, LaunchArguments.fromIntent(null))
    }

    @Test
    fun systemLinksRoundTripAndRejectNonWebOpens() {
        val links = listOf(SystemLink.Search("two words"), SystemLink.Search(null), SystemLink.VoiceSearch, SystemLink.Incognito,
            SystemLink.Open("https://example.com/a?b=c"), SystemLink.Tab("ABC-123"), SystemLink.MacTabs)
        for (link in links) assertEquals(link, SystemLink.parse(link.uri))
        assertNull(SystemLink.parse("ardia://open?url=javascript%3Aalert(1)"))
        assertNull(SystemLink.parse("https://example.com/"))
        assertEquals(SystemLink.Search(null), SystemLink.parse("ardia://search?q=%20%20"))
    }

    @Test
    fun theSettleSpringStartsAtRestAndArrives() {
        assertEquals(0.0, PagerModel.springValue(Motion.pagerSettle, 300.0, 0.0, 0.0), 1e-9)
        assertEquals(300.0, PagerModel.springValue(Motion.pagerSettle, 300.0, 0.0, 2.0), 0.01)
        val halfway = PagerModel.springValue(Motion.pagerSettle, 300.0, 0.0, 0.1)
        assertTrue(halfway > 0 && halfway < 300)
        val faster = PagerModel.springValue(Motion.pagerSettle, 300.0, 2_000.0, 0.1)
        assertTrue(faster > halfway)
    }

    @Test
    fun thePagerFindsNeighboursAndCatchesASettleWhereItIs() {
        fun tab(id: String) = BrowserTab(id, "https://$id.example/", created = 0)
        var now = 0L
        val pager = PagerModel(clock = { now })
        assertFalse(pager.begin(listOf(tab("a")), "missing"))
        assertTrue(pager.begin(listOf(tab("a"), tab("b"), tab("c")), "b"))
        assertEquals("a", pager.left?.id)
        assertEquals("c", pager.right?.id)
        pager.offset = -40f
        pager.startSettle(to = -400f, velocity = 0f)
        assertEquals(-40f, pager.presentedOffset(), 0.01f)
        now = 100_000_000L
        val caughtAt = pager.presentedOffset()
        pager.catchSettle()
        assertEquals(caughtAt, pager.offset, 0.01f)
        assertTrue(caughtAt < -40f && caughtAt > -400f)
        pager.reset()
        assertFalse(pager.isActive)
        assertNull(pager.current)
    }
}
