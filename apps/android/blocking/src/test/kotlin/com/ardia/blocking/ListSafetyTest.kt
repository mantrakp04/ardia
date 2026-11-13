package com.ardia.blocking

import java.io.File
import java.util.zip.CRC32
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ListSafetyTest {
    private val reviewerRule = "/^" + "()?".repeat(24) + "\$/"

    private val hostile = listOf(
        reviewerRule,
        "/^" + "(()?)?".repeat(24) + "\$/",
        "/^" + "(|a|)".repeat(30) + "b/",
        "/^" + "a?".repeat(30) + "a".repeat(30) + "\$/",
        "/" + "(a?){30}" + "a{30}/",
        "/(a+)+b/",
        "/(a*)*b/",
        "/(a|aa)+b/",
        "/(\\w+\\s?)+\$/",
        "/^(([a-z])+.)+[A-Z]([a-z])+\$/",
        "/(.*a){12}/",
        "/.*a.*a.*a.*a.*a.*a.*b/",
    )

    private fun millis(block: () -> Unit): Double {
        val start = System.nanoTime()
        block()
        return (System.nanoTime() - start) / 1_000_000.0
    }

    @Test
    fun hostileRegexRulesRunInLinearTimeOnLongUrls() {
        var slowest = 0.0
        for (rule in hostile) {
            val parsed = FilterParser.parse(rule, "hostile")
            assertEquals(rule, 1, parsed.network.size)
            val engine = engineOf(rule)
            for (body in listOf("a".repeat(30_000), "".padEnd(30_000, 'x'), "ab".repeat(15_000))) {
                val url = "https://site.test/$body"
                engine.blocks(url, "https://site.test/")
                val elapsed = millis { engine.blocks(url, "https://site.test/") }
                assertTrue("$rule on ${url.length} chars took $elapsed ms", elapsed < 100)
                slowest = maxOf(slowest, elapsed)
            }
        }
        println("ArdiaBlockingTiming slowest hostile regex request on a 30000-char url: %.2f ms".format(slowest))
        val source = reviewerRule.substring(1, reviewerRule.length - 1)
        val direct = ListRegex.compile(source, matchCase = false)!!
        val input = "a".repeat(30_000)
        direct.matcher(input).find()
        val elapsed = millis { direct.matcher(input).find() }
        println("ArdiaBlockingTiming reviewer pattern on the whole 30000-char input without the url cap: %.2f ms".format(elapsed))
        assertTrue("took $elapsed ms", elapsed < 100)
    }

    @Test
    fun regexRulesRe2CannotRunAreSkippedAndCounted() {
        val unsupported = listOf(
            "/(a+)\\1/",
            "/x(?=a+)y/",
            "/(?<!a)b/",
            "/a{1,99999}/",
            "/((a{100}){100}){100}/",
            "/(" + "a".repeat(1100) + ")/",
        )
        val parsed = FilterParser.parse(unsupported.joinToString("\n"), "unsupported")
        assertEquals(0, parsed.network.size)
        assertEquals(unsupported.size, parsed.skipped[SkipReason.UNSUPPORTED_REGEX])
        assertNull(ListRegex.compile("(a{1000}){2}", matchCase = false))
        assertNotNull(ListRegex.compile("(\\d){1,3}\\.(\\d){1,3}", matchCase = false))
        assertEquals("(?:a(?:b))[(]\\((?:x)(?:z)", ListRegex.withoutCaptures("(a(b))[(]\\((?:x)(?<name>z)"))
    }

    @Test
    fun manyStarPatternsAreBoundedToo() {
        val pattern = (1..60).joinToString("*") { "a" } + "*b"
        val engine = engineOf(pattern)
        val url = "https://site.test/" + "a".repeat(30_000)
        engine.blocks(url, "https://site.test/")
        val elapsed = millis { assertFalse(engine.blocks(url, "https://site.test/")) }
        assertTrue("took $elapsed ms", elapsed < 100)
    }

    @Test
    fun aListOverItsBudgetStopsEarlyWithoutHoldingItAll() {
        val small = (0 until 2_000).joinToString("\n") { "||x$it.test^" }
        try {
            FilterParser.parse(small, "small", maxRules = 1_000)
            fail("expected the list to be too large")
        } catch (error: FilterListTooLargeException) {
            assertEquals("small", error.listId)
        }
        try {
            FilterParser.parse(small, "small", maxChars = 5_000)
            fail("expected the list to be too large")
        } catch (error: FilterListTooLargeException) {
        }

        TempDirectory().use { directory ->
            val file = File(directory.file, "huge.txt")
            file.bufferedWriter().use { out -> for (index in 0 until 2_000_000) out.append("||x").append(index.toString()).append(".test^\n") }
            println("ArdiaBlockingTiming hostile list ${file.length() / 1_000_000.0} MB on disk")
            val elapsed = millis {
                try {
                    file.bufferedReader().use { FilterParser.parse(it, "huge") }
                    fail("expected the list to be too large")
                } catch (error: FilterListTooLargeException) {
                }
            }
            println("ArdiaBlockingTiming hostile list refused after %.0f ms".format(elapsed))

            val runtime = Runtime.getRuntime()
            System.gc()
            val before = runtime.totalMemory() - runtime.freeMemory()
            val atLimit = file.bufferedReader().useLines { lines -> lines.take(ListBudget().maxRulesPerList).joinToString("\n") }
            val parsed = FilterParser.parse(atLimit, "at-limit")
            System.gc()
            val retained = runtime.totalMemory() - runtime.freeMemory() - before - atLimit.length * 2L
            println("ArdiaBlockingTiming a list at the ${parsed.network.size}-rule budget retains about ${retained / 1_000_000} MB")
            assertEquals(ListBudget().maxRulesPerList, parsed.network.size)
            assertTrue("retained $retained bytes", retained < 120_000_000)
        }
    }

    @Test
    fun aTooLargeListIsShownAndNeverTakesTheOthersDown() = runBlocking {
        val entries = listOf(Fixture.entry("first"), Fixture.entry("second"), Fixture.entry("third"))
        Fixture(FilterListCatalog("test", entries)).use { fixture ->
            val budget = ListBudget(maxRulesPerList = 50, maxCharsPerList = 1_000_000, maxRulesTotal = 80, maxCharsTotal = 1_000_000)
            val lists = FilterLists(
                fixture.directory.file, fixture.store, fixture.downloader, listOf("en-US"), catalog = fixture.catalog,
                clock = { fixture.clock.now }, scope = fixture.scope, budget = budget,
            )
            fun rules(prefix: String, count: Int) = (0 until count).joinToString("\n") { "||$prefix$it.test^" }
            fixture.downloader.serve("https://lists.test/first.txt", rules("a", 30))
            fixture.downloader.serve("https://lists.test/second.txt", rules("b", 200))
            fixture.downloader.serve("https://lists.test/third.txt", rules("c", 40))
            lists.updateNow()
            assertEquals(FilterListState.TooLarge, lists.list("second")!!.state)
            assertEquals(FilterListState.Ready, lists.list("first")!!.state)
            assertEquals(FilterListState.Ready, lists.list("third")!!.state)
            assertNotNull(lists.state.value.buildError)
            assertEquals(listOf("first", "third"), lists.compiled.value!!.sources.map { it.list.id })

            fixture.downloader.serve("https://lists.test/second.txt", rules("b", 20))
            lists.updateNow()
            assertEquals(listOf("first", "second"), lists.compiled.value!!.sources.map { it.list.id })
            assertEquals(FilterListState.TooLarge, lists.list("third")!!.state)

            fixture.downloader.serve("https://lists.test/second.txt", rules("b", 500))
            lists.updateNow()
            assertEquals(FilterListState.TooLarge, lists.list("second")!!.state)
            val kept = lists.compiled.value!!.sources.first { it.list.id == "second" }
            assertEquals(20, kept.list.network.size)

            fixture.downloader.serve("https://lists.test/big.txt", rules("d", 60))
            assertEquals(FilterListError.TooLarge.message, lists.addList("https://lists.test/big.txt"))
            val mine = lists.applyMyFilters(rules("e", 60))
            assertTrue(mine.isTooLarge)
            assertEquals(0, mine.ruleCount)
            assertTrue(lists.compiled.value!!.sources.none { it.isOwner })
            assertTrue(lists.compiled.value!!.sources.any { it.list.id == "first" })
        }
    }

    @Test
    fun aDamagedCacheIsRejectedAndRebuilt() = runBlocking {
        Fixture(FilterListCatalog("test", listOf(Fixture.entry("easylist")))).use { fixture ->
            fixture.downloader.serve("https://lists.test/easylist.txt", resource("easylist-sample.txt"))
            fixture.lists().updateNow()
            val cache = File(File(fixture.directory.file, "Compiled"), "easylist.bin")
            val good = cache.readBytes()
            val source = File(File(fixture.directory.file, "Lists"), "easylist.txt")
            fun readCache() = CompiledListFile.read(cache, source.length(), source.lastModified())
            assertNotNull(readCache())

            cache.writeBytes(good.copyOf(good.size / 2))
            assertNull(readCache())
            cache.writeBytes(good.copyOf().also { it[it.size / 2] = (it[it.size / 2] + 1).toByte() })
            assertNull(readCache())
            cache.writeBytes(good.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
            assertNull(readCache())
            cache.writeBytes(ByteArray(0))
            assertNull(readCache())

            val idLength = "easylist".toByteArray().size
            val forgedCount = good.copyOf()
            val countOffset = 4 + 4 + 8 + 8 + 4 + idLength + 4 + 4 + 4
            val skippedReasons = java.nio.ByteBuffer.wrap(forgedCount, countOffset - 4, 4).int
            val networkOffset = countOffset + skippedReasons * 8
            java.nio.ByteBuffer.wrap(forgedCount, networkOffset, 4).putInt(Int.MAX_VALUE)
            cache.writeBytes(resealed(forgedCount))
            assertNull(readCache())

            val forged = ParsedFilterList(
                "easylist", 1, 0,
                listOf(NetworkFilter("/long/", false, false, false, Party.ANY, RequestType.SUBRESOURCES, Anchor.NONE, false, null, "a".repeat(2_000), true, emptyList(), emptyList())),
                emptyList(), emptySet(), emptyList(), emptyList(), emptyList(), emptyMap(),
            )
            CompiledListFile.write(cache, forged, source.length(), source.lastModified())
            assertNull(readCache())

            val relaunched = fixture.lists()
            relaunched.loadCompiled()
            assertEquals(1, relaunched.lastBuildStats.parsed)
            assertTrue(FilterEngine.build(relaunched.compiled.value!!.sources).blocks("https://000491b06a.com/x", "https://a.test/"))
            assertNotNull(readCache())
        }
    }

    private fun resealed(bytes: ByteArray): ByteArray {
        val crc = CRC32()
        crc.update(bytes, 0, bytes.size - 8)
        java.nio.ByteBuffer.wrap(bytes, bytes.size - 8, 8).putLong(crc.value)
        return bytes
    }
}
