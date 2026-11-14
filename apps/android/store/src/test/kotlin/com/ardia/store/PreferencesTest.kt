package com.ardia.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PreferencesTest {
    @Test
    fun defaultsMatchTheIphone() {
        val settings = BrowsingPreferences(MemoryKeyValueStore()).current
        assertEquals(NightShadeMode.DISABLED, settings.nightShade)
        assertEquals(SwipeNavigationMode.ANYWHERE, settings.swipeNavigation)
        assertEquals(AppLinkPreference.ARDIA, settings.appLinks)
        assertTrue(settings.searchSuggestions)
        assertEquals("google", settings.searchEngineId)
        val app = AppPreferences(MemoryKeyValueStore()).settings.value
        assertEquals(AppSettings(collapsesBottomBar = false, autoOpensKeyboard = true, hasFinishedOnboarding = false, archiveCardShown = false), app)
    }

    @Test
    fun everyChoiceSurvivesARelaunchUnderTheIphoneKeys() {
        val store = MemoryKeyValueStore()
        val preferences = BrowsingPreferences(store)
        preferences.setNightShade(NightShadeMode.AUTOMATIC)
        preferences.setSwipeNavigation(SwipeNavigationMode.SCREEN_EDGES)
        preferences.setAppLinks(AppLinkPreference.APP)
        preferences.setSearchSuggestions(false)
        preferences.setSearchEngine("duckduckgo")
        preferences.updateSite("www.Example.com") { it.copy(pageZoom = 1.25, desktopSite = true, blockersOff = true) }
        AppPreferences(store).apply {
            finishOnboarding()
            setAutoOpensKeyboard(false)
            setCollapsesBottomBar(true)
            setArchiveCardShown(true)
        }
        assertEquals("automatic", store.string("browsing.nightShade"))
        assertEquals("screenEdges", store.string("browsing.swipeNavigation"))
        assertEquals("duckduckgo", store.string("browsing.searchEngine"))
        assertEquals(true, store.boolean("settings.finishedOnboarding"))

        val reloaded = BrowsingPreferences(store).current
        assertEquals(NightShadeMode.AUTOMATIC, reloaded.nightShade)
        assertEquals(SwipeNavigationMode.SCREEN_EDGES, reloaded.swipeNavigation)
        assertEquals(AppLinkPreference.APP, reloaded.appLinks)
        assertFalse(reloaded.searchSuggestions)
        assertEquals("duckduckgo", reloaded.searchEngineId)
        assertEquals(1.25, reloaded.pageZoom("example.com"), 0.0)
        assertTrue(reloaded.desktopSite("EXAMPLE.com."))
        assertTrue(reloaded.blockersOff("example.com"))
        assertEquals(AppSettings(true, false, true, true), AppPreferences(store).settings.value)
    }

    @Test
    fun aSiteFallsBackToTheGlobalChoiceAndIsForgottenWhenNothingIsSet() {
        val store = MemoryKeyValueStore()
        val preferences = BrowsingPreferences(store)
        preferences.setNightShade(NightShadeMode.ALWAYS)
        preferences.updateSite("news.example") { it.copy(nightShade = NightShadeMode.DISABLED) }
        assertEquals(NightShadeMode.DISABLED, preferences.current.nightShade("news.example"))
        assertEquals(NightShadeMode.ALWAYS, preferences.current.nightShade("other.example"))
        assertEquals(NightShadeMode.ALWAYS, preferences.current.nightShade(null))
        preferences.updateSite("news.example") { it.copy(nightShade = null) }
        assertTrue(preferences.current.sites.isEmpty())
        assertEquals("{}", store.string("browsing.sites"))
    }

    @Test
    fun privateSiteSettingsStayInMemoryAndEndWithPrivateBrowsing() {
        val store = MemoryKeyValueStore()
        val preferences = BrowsingPreferences(store)
        preferences.updateSite("example.com") { it.copy(pageZoom = 1.5) }
        preferences.updateSite("example.com", isPrivate = true) { it.copy(nightShade = NightShadeMode.ALWAYS) }
        assertEquals(NightShadeMode.ALWAYS, preferences.current.nightShade("example.com", isPrivate = true))
        assertEquals(1.5, preferences.current.pageZoom("example.com", isPrivate = true), 0.0)
        assertEquals(NightShadeMode.DISABLED, preferences.current.nightShade("example.com"))
        assertNull(BrowsingPreferences(store).current.sites["example.com"]?.nightShade)
        preferences.endPrivateBrowsing()
        assertEquals(NightShadeMode.DISABLED, preferences.current.nightShade("example.com", isPrivate = true))
    }

    @Test
    fun theSiteListKeepsTheFiveHundredMostRecentlyChanged() {
        val preferences = BrowsingPreferences(MemoryKeyValueStore())
        for (index in 0..BrowsingPreferences.SITE_LIMIT) preferences.updateSite("site$index.example") { it.copy(pageZoom = 1.1) }
        val sites = preferences.current.sites
        assertEquals(BrowsingPreferences.SITE_LIMIT, sites.size)
        assertFalse(sites.containsKey("site0.example"))
        assertTrue(sites.containsKey("site${BrowsingPreferences.SITE_LIMIT}.example"))
    }

    @Test
    fun theColorChoiceSurvivesARelaunchAndNoChoiceMeansMatchTheMac() {
        val store = MemoryKeyValueStore()
        val preferences = AppPreferences(store)
        assertTrue(preferences.settings.value.matchesMac)
        assertEquals(LookSource.MacProfile, preferences.settings.value.look(syncEnabled = true))
        assertEquals(LookSource.Preset(ColorChoice.PLUM), preferences.settings.value.look(syncEnabled = false))
        preferences.setColorChoice(ColorChoice.GREEN)
        assertEquals("green", store.string("settings.color"))
        assertEquals(LookSource.Preset(ColorChoice.GREEN), AppPreferences(store).settings.value.look(syncEnabled = true))
        preferences.setMatchesMac(true)
        assertNull(store.string("settings.color"))
        assertTrue(AppPreferences(store).settings.value.matchesMac)
    }

    @Test
    fun turningOffMatchMyMacKeepsTheColorOnScreen() {
        val preferences = AppPreferences(MemoryKeyValueStore())
        preferences.setMatchesMac(false, shownChoice = ColorChoice.BLUE)
        assertEquals(ColorChoice.BLUE, preferences.settings.value.colorChoice)
        preferences.setMatchesMac(true)
        preferences.setMatchesMac(false)
        assertEquals(ColorChoice.PLUM, preferences.settings.value.colorChoice)
    }

    @Test
    fun anUnknownStoredColorReadsAsMatchTheMac() {
        val store = MemoryKeyValueStore()
        store.putString("settings.color", "teal")
        assertNull(AppPreferences(store).settings.value.colorChoice)
        assertEquals(listOf("plum", "blue", "purple", "pink", "red", "orange", "yellow", "green", "neutral"), ColorChoice.entries.map { it.raw })
    }

    @Test
    fun damagedSiteDataFallsBackToNoSites() {
        val store = MemoryKeyValueStore()
        store.putString("browsing.sites", "{not json")
        assertTrue(BrowsingPreferences(store).current.sites.isEmpty())
    }
}
