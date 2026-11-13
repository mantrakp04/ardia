package com.ardia.blocking

import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterListsTest {
    @Test
    fun defaultsMatchUBlockOriginPlusTheDevicesLanguageAndCookieNotices() {
        val catalog = FilterListCatalog.bundled
        assertEquals("1.75.0", catalog.ubo)
        val ubo = setOf("ublock-filters", "ublock-badware", "ublock-privacy", "ublock-unbreak", "ublock-quick-fixes", "easylist", "easyprivacy", "urlhaus-1", "plowe-0")
        assertEquals(ubo, catalog.lists.filter { !it.off }.map { it.id }.toSet())
        assertEquals(ubo + "fanboy-cookiemonster", catalog.defaultSelection(listOf("en-US"), isMobile = false))
        assertEquals(ubo + setOf("fanboy-cookiemonster", "DEU-0", "adguard-mobile"), catalog.defaultSelection(listOf("de-DE", "en-GB"), isMobile = true))
        assertTrue("spa-1" in catalog.defaultSelection(listOf("pt-BR"), isMobile = false))
        assertTrue(catalog.lists.all { entry -> entry.urls.isNotEmpty() && entry.urls.all { it.startsWith("https://") } })
        assertEquals(BlockingCategory.COOKIE_BANNERS, catalog.lists.first { it.id == "fanboy-cookiemonster" }.category)
        assertEquals(BlockingCategory.TRACKERS, catalog.lists.first { it.id == "easyprivacy" }.category)
        assertEquals(BlockingCategory.ADS, catalog.lists.first { it.id == "easylist" }.category)
    }

    @Test
    fun aFailedDownloadKeepsTheLastGoodBuild() = runBlocking {
        Fixture(FilterListCatalog("test", listOf(Fixture.entry("good"), Fixture.entry("spare", off = true)))).use { fixture ->
            val lists = fixture.lists()
            fixture.downloader.serve("https://lists.test/good.txt", "! Title: Good\n||ads.example^\n||tracker.example^\$third-party\n##.ad\n##+js(nope)")
            lists.updateNow()
            val first = lists.list("good")!!
            assertEquals(3, first.ruleCount)
            assertEquals(1, first.skippedCount)
            assertEquals(FilterListState.Ready, first.state)
            assertEquals(fixture.clock.now, first.updatedAt)
            assertEquals(listOf("good"), lists.compiled.value!!.sources.map { it.list.id })
            assertFalse(lists.list("spare")!!.isEnabled)

            fixture.downloader.serve("https://lists.test/good.txt", "", status = 503)
            lists.updateNow()
            assertEquals(listOf("good"), lists.compiled.value!!.sources.map { it.list.id })
            assertEquals(3, lists.list("good")!!.ruleCount)
            assertEquals(FilterListState.Failed(DownloadMessages.SERVER), lists.list("good")!!.state)

            fixture.downloader.serve("https://lists.test/good.txt", "<!doctype html><html><body>Not found</body></html>")
            lists.updateNow()
            assertEquals(1, lists.compiled.value!!.sources.size)
            assertEquals(3, lists.list("good")!!.ruleCount)
            assertEquals(FilterListState.Failed(FilterListError.NotAFilterList.message), lists.list("good")!!.state)

            fixture.downloader.online = false
            lists.updateNow()
            assertTrue(lists.state.value.isOffline)
            assertEquals(FilterListState.Offline, lists.list("good")!!.state)
            assertEquals(3, lists.list("good")!!.ruleCount)
        }
    }

    @Test
    fun customListsAreValidatedAndMyFiltersApplyLast() = runBlocking {
        Fixture().use { fixture ->
            val lists = fixture.lists()
            fixture.downloader.serve("https://lists.test/page.html", "<!doctype html><html><body>Hello</body></html>")
            fixture.downloader.serve("https://lists.test/mine.txt", "! Title: Neighbourhood List\n||local-ads.example^\n@@||friend.example^")
            assertEquals(FilterListError.InvalidAddress.message, lists.addList("http://lists.test/x.txt"))
            assertEquals(FilterListError.NotAFilterList.message, lists.addList("https://lists.test/page.html"))
            assertEquals(DownloadMessages.NOT_FOUND, lists.addList("https://lists.test/missing.txt"))
            assertNull(lists.addList("https://lists.test/mine.txt"))
            assertEquals(FilterListError.AlreadyAdded.message, lists.addList("https://lists.test/mine.txt"))
            val added = lists.state.value.lists.first { it.isCustom }
            assertEquals("Neighbourhood List", added.title)
            assertTrue(added.isEnabled && added.group == FilterListGroup.CUSTOM)
            assertEquals(2, added.ruleCount)

            val result = lists.applyMyFilters("||friend.example^\nnews.example##.paywall\n##+js(skip)")
            assertEquals(MyFiltersResult(2, 1), result)
            val sources = lists.compiled.value!!.sources
            assertTrue(sources.any { it.isOwner && it.list.id == FilterLists.MY_FILTERS_ID && it.category == null })

            val engine = FilterEngine.build(sources)
            assertTrue(engine.blocks("https://friend.example/x", "https://a.test/"))
            assertTrue(engine.blocks("https://local-ads.example/x", "https://a.test/"))

            val reloaded = fixture.lists()
            assertTrue(reloaded.state.value.myFilters.contains("news.example##.paywall"))
            assertTrue(reloaded.state.value.lists.any { it.isCustom && it.title == "Neighbourhood List" })
            reloaded.loadCompiled()
            assertEquals(sources.size, reloaded.compiled.value!!.sources.size)
            assertEquals(MyFiltersResult(2, 1), reloaded.state.value.myFiltersResult)

            lists.removeList(added.id).join()
            assertFalse(lists.state.value.lists.any { it.isCustom })
            assertFalse(lists.sourceFile(added.id).exists())
            assertTrue(lists.compiled.value!!.sources.none { it.list.id == added.id })
        }
    }

    @Test
    fun launchReadsTheCompiledCacheInsteadOfParsing() = runBlocking {
        Fixture(FilterListCatalog("test", listOf(Fixture.entry("easylist"), Fixture.entry("easyprivacy", group = "privacy")))).use { fixture ->
            fixture.downloader.serve("https://lists.test/easylist.txt", resource("easylist-sample.txt"))
            fixture.downloader.serve("https://lists.test/easyprivacy.txt", resource("easyprivacy-sample.txt"))
            fixture.lists().updateNow()

            val relaunched = fixture.lists()
            assertNull(relaunched.compiled.value)
            val source = relaunched.sourceFile("easylist")
            val modified = source.lastModified()
            val swapped = source.readText().replace("||000491b06a.com^", "||000491b06a.org^")
            source.writeText(swapped)
            source.setLastModified(modified)
            relaunched.loadCompiled()
            assertEquals(FilterLists.BuildStats(reused = 2, parsed = 0, millis = relaunched.lastBuildStats.millis), relaunched.lastBuildStats)
            val engine = FilterEngine.build(relaunched.compiled.value!!.sources)
            assertTrue(engine.blocks("https://000491b06a.com/x", "https://a.test/"))
            assertEquals(BlockingCategory.TRACKERS, relaunched.compiled.value!!.sources.first { it.list.id == "easyprivacy" }.category)

            source.setLastModified(modified + 2000)
            relaunched.rebuild()
            assertEquals(1, relaunched.lastBuildStats.parsed)
            assertEquals(1, relaunched.lastBuildStats.reused)
            val rebuilt = FilterEngine.build(relaunched.compiled.value!!.sources)
            assertTrue(rebuilt.blocks("https://000491b06a.org/x", "https://a.test/"))
        }
    }

    @Test
    fun updatesFollowTheIphonesSchedule() = runBlocking {
        val entries = listOf(Fixture.entry("weekly", updateAfter = 5), Fixture.entry("later", off = true))
        Fixture(FilterListCatalog("test", entries)).use { fixture ->
            val lists = fixture.lists()
            val downloads = fixture.downloader
            downloads.serve("https://lists.test/weekly.txt", "||one.example^", etag = "\"v1\"")
            lists.updateIfNeeded(fixture.clock.now)
            assertEquals(1, downloads.calls.get())
            assertTrue(downloads.requests.last().allowExpensive)

            fixture.clock.advanceDays(4.0)
            lists.updateIfNeeded(fixture.clock.now)
            assertEquals(1, downloads.calls.get())

            fixture.clock.advanceDays(2.0)
            downloads.expensive = true
            lists.updateIfNeeded(fixture.clock.now)
            assertEquals(2, downloads.calls.get())
            assertFalse(downloads.requests.last().allowExpensive)
            assertEquals(FilterListState.Offline, lists.list("weekly")!!.state)

            downloads.expensive = false
            lists.updateIfNeeded(fixture.clock.now)
            assertEquals("\"v1\"", downloads.requests.last().etag)
            assertEquals(fixture.clock.now, lists.list("weekly")!!.updatedAt)
            assertEquals(FilterListState.Ready, lists.list("weekly")!!.state)

            fixture.clock.advanceDays(11.0)
            downloads.expensive = true
            downloads.serve("https://lists.test/weekly.txt", "||one.example^\n||two.example^", etag = "\"v2\"")
            lists.updateIfNeeded(fixture.clock.now)
            assertTrue(downloads.requests.last().allowExpensive)
            assertEquals(2, lists.list("weekly")!!.ruleCount)
            assertEquals(fixture.clock.now, lists.state.value.lastUpdated)

            downloads.serve("https://lists.test/later.txt", "||later.example^")
            lists.setEnabled("later", true).join()
            assertEquals(1, lists.list("later")!!.ruleCount)
            assertTrue(lists.compiled.value!!.sources.any { it.list.id == "later" })
            lists.setEnabled("later", false).join()
            assertTrue(lists.compiled.value!!.sources.none { it.list.id == "later" })
        }
    }

    @Test
    fun restoringDefaultsDropsAddedListsAndBringsBackTheDefaultSelection() = runBlocking {
        Fixture(FilterListCatalog("test", listOf(Fixture.entry("base"), Fixture.entry("extra", off = true)))).use { fixture ->
            val lists = fixture.lists()
            fixture.downloader.serve("https://lists.test/base.txt", "||base.example^")
            fixture.downloader.serve("https://lists.test/extra.txt", "||extra.example^")
            fixture.downloader.serve("https://lists.test/own.txt", "||own.example^")
            lists.setEnabled("base", false).join()
            lists.setEnabled("extra", true).join()
            assertNull(lists.addList("https://lists.test/own.txt"))
            assertEquals(1, lists.state.value.customListCount)
            lists.resetToDefaults()
            assertEquals(0, lists.state.value.customListCount)
            assertEquals(listOf("base"), lists.state.value.enabledLists.map { it.id })
            assertEquals(listOf("base"), lists.compiled.value!!.sources.map { it.list.id })
            assertTrue(lists.list("base")!!.isDefault)
            assertFalse(lists.list("extra")!!.isDefault)
        }
    }

    @Test
    fun demoListsLookRealAndNeverTouchTheNetwork() = runBlocking {
        Fixture().use { fixture ->
            val demo = FilterLists.demo(fixture.directory.file, fixture.store, fixture.scope)
            assertEquals(84792, demo.list("easylist")!!.ruleCount)
            assertTrue(demo.state.value.enabledLists.all { it.ruleCount > 0 && it.updatedAt != null })
            demo.seedDemo(mapOf("easylist" to FilterListState.Downloading, "easyprivacy" to FilterListState.Failed("The server didn’t respond."), "plowe-0" to FilterListState.Offline))!!.join()
            assertEquals(FilterListState.Downloading, demo.list("easylist")!!.state)
            assertTrue(demo.state.value.isOffline && demo.state.value.isUpdating)
            demo.updateNow()
            assertEquals(FilterListState.Downloading, demo.list("easylist")!!.state)
            assertNull(demo.addList("https://lists.example/neighbourhood.txt"))
            assertTrue(demo.state.value.lists.any { it.isCustom && it.ruleCount == 1240 })
            assertFalse(File(fixture.directory.file, "Lists").exists())
        }
    }

    @Test
    fun addressesAreCheckedBeforeAnythingIsFetched() {
        assertEquals(FilterListAddress.Validation.Invalid("Enter the list’s address."), FilterListAddress.validate("  "))
        assertEquals(FilterListError.InvalidAddress.message, (FilterListAddress.validate("ftp://x.test/a") as FilterListAddress.Validation.Invalid).message)
        assertNull(FilterListAddress.validate("https://localhost/list.txt").url)
        assertEquals("https://lists.test/a.txt", FilterListAddress.validate(" https://lists.test/a.txt ").url)
        assertNotNull(FilterListAddress.validate("http://lists.test/a.txt").url)
        assertTrue(FilterLists.looksLikeFilterList("0.0.0.0 ads.example\n"))
        assertFalse(FilterLists.looksLikeFilterList("<html><body>404</body></html>"))
        assertEquals("Neighbourhood", FilterLists.title("[Adblock Plus 2.0]\n! Title: Neighbourhood\n"))
    }
}
