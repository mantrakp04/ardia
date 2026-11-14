package com.ardia.blocking

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentBlockerTest {
    private val catalog = FilterListCatalog(
        "test",
        listOf(
            Fixture.entry("easylist"),
            Fixture.entry("easyprivacy", group = "privacy"),
            Fixture.entry("fanboy-cookiemonster", group = "annoyances", group2 = "cookies"),
        ),
    )

    private fun Fixture.serveSamples() {
        downloader.serve("https://lists.test/easylist.txt", resource("easylist-sample.txt"))
        downloader.serve("https://lists.test/easyprivacy.txt", resource("easyprivacy-sample.txt"))
        downloader.serve("https://lists.test/fanboy-cookiemonster.txt", resource("cookie-sample.txt"))
    }

    @Test
    fun seedsWorkAtOnceAndDownloadedListsJoinAfterTheRefresh() = runBlocking {
        Fixture(catalog).use { fixture ->
            fixture.serveSamples()
            val blocker = ContentBlocker(BlockingSettings(fixture.store), fixture.lists(), fixture.scope)
            assertEquals(ContentBlockerState.Preparing, blocker.state.value)
            assertTrue(blocker.blocks("https://securepubads.g.doubleclick.net/gpt.js", "https://news.test/", false))
            assertFalse(blocker.blocks("https://000491b06a.com/x", "https://news.test/", false))
            blocker.prepare()
            assertEquals(ContentBlockerState.Ready(null), blocker.state.value)
            blocker.refreshIfDue(fixture.clock.now)
            assertEquals(ContentBlockerState.Ready(fixture.clock.now), blocker.state.value)
            assertTrue(blocker.blocks("https://000491b06a.com/x", "https://news.test/", false))
            assertTrue(blocker.blocks("https://www.googletagmanager.com/gtm.js", "https://news.test/", false))
            assertFalse(blocker.blocks("https://www.googletagmanager.com/gtm.js", "https://9to5mac.com/", false))
            assertTrue(blocker.engine.stats.blockRules > 400)
        }
    }

    @Test
    fun aRelaunchServesTheCachedListsWithoutTheNetwork() = runBlocking {
        Fixture(catalog).use { fixture ->
            fixture.serveSamples()
            ContentBlocker(BlockingSettings(fixture.store), fixture.lists(), fixture.scope).refreshIfDue(fixture.clock.now)
            val calls = fixture.downloader.calls.get()
            fixture.downloader.online = false
            val lists = fixture.lists()
            val relaunched = ContentBlocker(BlockingSettings(fixture.store), lists, fixture.scope)
            relaunched.prepare()
            assertEquals(0, lists.lastBuildStats.parsed)
            assertEquals(3, lists.lastBuildStats.reused)
            assertTrue(relaunched.blocks("https://000491b06a.com/x", "https://news.test/", false))
            relaunched.refreshIfDue(fixture.clock.now)
            assertEquals(calls, fixture.downloader.calls.get())
        }
    }

    @Test
    fun scriptsFollowTheSwitchesAndTheSiteException() = runBlocking {
        Fixture(catalog).use { fixture ->
            fixture.serveSamples()
            val settings = BlockingSettings(fixture.store)
            val blocker = ContentBlocker(settings, fixture.lists(), fixture.scope)
            blocker.refreshIfDue(fixture.clock.now)
            val start = blocker.scriptsAtDocumentStart("https://fruugo.co.nz/basket")
            assertEquals(2, start.size)
            assertTrue(start[1].contains("#CookieBanner"))
            assertEquals(listOf(BlockingScripts.consent), blocker.scriptsAtDocumentEnd("https://fruugo.co.nz/basket"))
            assertTrue(blocker.scriptsAtDocumentStart("about:blank").isEmpty())

            settings.hidesCookieBanners = false
            assertTrue(blocker.scriptsAtDocumentEnd("https://fruugo.co.nz/basket").isEmpty())
            assertFalse(blocker.scriptsAtDocumentStart("https://fruugo.co.nz/basket").joinToString().contains("#CookieBanner"))
            settings.hidesCookieBanners = true

            assertEquals("Blockers disabled for fruugo.co.nz", blocker.setBlockersEnabled("https://fruugo.co.nz/x", false))
            assertFalse(blocker.blockersEnabled("https://fruugo.co.nz/"))
            assertTrue(blocker.scriptsAtDocumentStart("https://fruugo.co.nz/basket").isEmpty())
            assertTrue(blocker.scriptsAtDocumentEnd("https://fruugo.co.nz/basket").isEmpty())
            assertFalse(blocker.blocks("https://securepubads.g.doubleclick.net/gpt.js", "https://fruugo.co.nz/", false))
            assertEquals("Blockers enabled for fruugo.co.nz", blocker.setBlockersEnabled("https://fruugo.co.nz/x", true))
            assertTrue(blocker.blocks("https://securepubads.g.doubleclick.net/gpt.js", "https://fruugo.co.nz/", false))
            assertNull(blocker.setBlockersEnabled("about:blank", false))
        }
    }

    @Test
    fun aPageFilterCountsWhatItBlocksAndKeepsPrivateExemptionsApart() = runBlocking {
        Fixture(catalog).use { fixture ->
            val settings = BlockingSettings(fixture.store)
            val blocker = ContentBlocker(settings, fixture.lists(), fixture.scope)
            val counter = BlockedResourceCounter()
            val page = blocker.pageFilter(isPrivate = true, counter = counter)
            assertTrue(page.blocks("https://securepubads.g.doubleclick.net/gpt.js", "https://news.test/", false))
            assertTrue(page.blocks("https://ib.adnxs.com/ut/v3", "https://news.test/", false))
            assertFalse(page.blocks("https://news.test/app.js", "https://news.test/", false))
            assertEquals(2, counter.count.value)
            blocker.setBlockersEnabled("https://news.test/", false, isPrivate = true)
            assertFalse(page.blocks("https://ib.adnxs.com/ut/v3", "https://news.test/", false))
            assertTrue(blocker.blocks("https://ib.adnxs.com/ut/v3", "https://news.test/", false))
            assertEquals(2, counter.count.value)
            counter.reset()
            assertEquals(0, counter.count.value)
        }
    }
}
