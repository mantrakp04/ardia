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
            if (parsed.network.isEmpty()) {
                assertEquals(rule, 1, parsed.skipped[SkipReason.UNSUPPORTED_REGEX])
                continue
            }
            val engine = engineOf(rule)
            for (body in listOf("a".repeat(30_000), "".padEnd(30_000, 'x'), "ab".repeat(15_000))) {
                val url = "https://site.test/$body"
                engine.blocks(url, "https://site.test/")
                val clock = java.lang.management.ManagementFactory.getThreadMXBean()
                val cpuStart = clock.currentThreadCpuTime
                engine.blocks(url, "https://site.test/")
                val elapsed = (clock.currentThreadCpuTime - cpuStart) / 1_000_000.0
                assertTrue("$rule on ${url.length} chars took $elapsed ms of cpu", elapsed < 100)
                slowest = maxOf(slowest, elapsed)
            }
        }
        println("ArdiaBlockingTiming slowest hostile regex request on a 30000-char url: %.2f ms of cpu".format(slowest))
        val source = reviewerRule.substring(1, reviewerRule.length - 1)
        val direct = com.google.re2j.Pattern.compile(ListRegex.withoutCaptures(source))
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
            "/(" + "a".repeat(9_000) + ")/",
        )
        val parsed = FilterParser.parse(unsupported.joinToString("\n"), "unsupported")
        assertEquals(0, parsed.network.size)
        assertEquals(unsupported.size, parsed.skipped[SkipReason.UNSUPPORTED_REGEX])
        assertNull(ListRegex.compile("(a{1000}){2}", matchCase = false))
        assertNotNull(ListRegex.compile("(\\d){1,3}\\.(\\d){1,3}", matchCase = false))
        assertEquals("(?:a(?:b))[(]\\((?:x)(?:z)", ListRegex.withoutCaptures("(a(b))[(]\\((?:x)(?<name>z)"))
    }

    @Test
    fun regexWorkIsMeteredAndCappedPerRequest() {
        val url = "https://site.test/" + "a".repeat(4_078)
        val context = RequestContext.current()
        val bean = java.lang.management.ManagementFactory.getThreadMXBean()
        val shapes = listOf(
            "reviewer" to { suffix: String -> "/.*" + "a?".repeat(490) + suffix + "/" },
            "maximal" to { suffix: String -> "/.*(?:a?){990}" + suffix + "/" },
            "small" to { suffix: String -> "/.*" + "a?".repeat(20) + suffix + "/" },
        )
        for ((name, shape) in shapes) {
            fun distinct(number: Int) = "[b\\x{" + (0x4E00 + number).toString(16) + "}]"
            val single = engineOf(shape(distinct(0)))
            assertEquals(1, single.stats.unindexedRules)
            repeat(2) { single.blocks(url, "https://site.test/") }
            single.blocks(url, "https://site.test/")
            val oneRun = ListRegex.stepsFor(url.length) - context.regexScratch.steps
            for (count in listOf(1, 300)) {
                val engine = engineOf((0 until count).joinToString("\n") { shape(distinct(it)) })
                repeat(2) { engine.blocks(url, "https://site.test/") }
                val runsBefore = context.regexRuns
                val skippedBefore = context.regexRulesSkipped
                val cpuBefore = bean.currentThreadCpuTime
                val elapsed = millis { assertFalse(engine.blocks(url, "https://site.test/")) }
                val cpu = (bean.currentThreadCpuTime - cpuBefore) / 1_000_000.0
                val runs = context.regexRuns - runsBefore
                val skipped = context.regexRulesSkipped - skippedBefore
                val used = ListRegex.stepsFor(url.length) - maxOf(context.regexScratch.steps, 0)
                println(
                    "ArdiaBlockingTiming %s x%d on a %d-char url: one rule costs %d steps; ran %d, skipped %d, steps %d of %d, cpu %.2f ms, wall %.2f ms"
                        .format(name, count, url.length, oneRun, runs, skipped, used, ListRegex.stepsFor(url.length), cpu, elapsed),
                )
                val admitted = minOf(count, ListRegex.MAX_UNINDEXED_PER_LIST)
                val budget = ListRegex.stepsFor(url.length)
                val completed = minOf(admitted, budget / oneRun)
                val partial = if (completed < admitted && budget - completed * oneRun >= ListRegex.STEPS_PER_RULE_CHECK) 1 else 0
                assertEquals((completed + partial).toLong(), runs)
                assertEquals((admitted - completed).toLong(), skipped)
                assertEquals(if (partial == 1) budget else completed * oneRun, used)
                assertTrue("cpu $cpu ms", cpu < 80)
            }
        }
        assertTrue(ListRegex.rulesSkippedForBudget > 0)
    }

    @Test
    fun aListOfManyRegexRulesWithoutATokenIsCappedAndEveryCheckIsCharged() {
        val list = (0 until 10_000).joinToString("\n") { "/.*aaaaaaaaaaaaaaaaaaaab" + it.toString().padStart(4, '0') + "/" }
        val parsed = FilterParser.parse(list, "reviewer")
        assertEquals(ListRegex.MAX_UNINDEXED_PER_LIST, parsed.network.size)
        assertEquals(10_000 - ListRegex.MAX_UNINDEXED_PER_LIST, parsed.skipped[SkipReason.UNINDEXED_REGEX])
        val engine = FilterEngine.build(listOf(EngineSource(parsed, BlockingCategory.ADS)))
        assertEquals(ListRegex.MAX_UNINDEXED_PER_LIST, engine.stats.unindexedRules)
        val url = "https://site.test/" + "a".repeat(15_997)
        assertEquals(16_015, url.length)
        val single = engineOf("/.*aaaaaaaaaaaaaaaaaaaab0000/")
        single.blocks(url, "https://site.test/")
        val context = RequestContext.current()
        val budget = ListRegex.stepsFor(url.length)
        val oneRun = budget - context.regexScratch.steps
        val bean = java.lang.management.ManagementFactory.getThreadMXBean()
        repeat(2) { engine.blocks(url, "https://site.test/") }
        val runsBefore = context.regexRuns
        val skippedBefore = context.regexRulesSkipped
        val cpuBefore = bean.currentThreadCpuTime
        val wall = millis { assertFalse(engine.blocks(url, "https://site.test/")) }
        val cpu = (bean.currentThreadCpuTime - cpuBefore) / 1_000_000.0
        val runs = context.regexRuns - runsBefore
        val skipped = context.regexRulesSkipped - skippedBefore
        val used = budget - maxOf(context.regexScratch.steps, 0)
        println(
            "ArdiaBlockingTiming reviewer list of 10000 untokened rules: %d admitted, one rule costs %d steps, ran %d, skipped %d, steps %d of %d, cpu %.2f ms, wall %.2f ms"
                .format(parsed.network.size, oneRun, runs, skipped, used, budget, cpu, wall),
        )
        assertTrue(oneRun < budget)
        val completed = budget / oneRun
        val partial = if (budget - completed * oneRun >= ListRegex.STEPS_PER_RULE_CHECK) 1 else 0
        assertEquals(if (partial == 1) budget else completed * oneRun, used)
        assertEquals((completed + partial).toLong(), runs)
        assertEquals((ListRegex.MAX_UNINDEXED_PER_LIST - completed).toLong(), skipped)
        assertTrue("cpu $cpu ms", cpu < 150)

        val many = (0 until 3).map { list -> EngineSource(FilterParser.parse((0 until 128).joinToString("\n") { "/.*q" + list + it.toString().padStart(4, '0') + "x/" }, "list$list"), BlockingCategory.ADS) }
        assertEquals(ListRegex.MAX_UNINDEXED_TOTAL - 0, FilterEngine.build(many).stats.unindexedRules)
        assertEquals(3 * 128 - ListRegex.MAX_UNINDEXED_TOTAL, FilterEngine.build(many).stats.regexRulesOverCap)
    }

    @Test
    fun domainScopedRegexRulesPayForEveryCheck() {
        val rules = (0 until 5_000).joinToString("\n") { "/x[0-9]{1,3}q" + it.toString().padStart(4, '0') + "/\$domain=site.test" }
        val engine = engineOf(rules)
        val url = "https://cdn.test/" + "x1".repeat(40)
        val context = RequestContext.current()
        val bean = java.lang.management.ManagementFactory.getThreadMXBean()
        repeat(2) { engine.blocks(url, "https://site.test/") }
        val runsBefore = context.regexRuns
        val cpuBefore = bean.currentThreadCpuTime
        assertFalse(engine.blocks(url, "https://site.test/"))
        val cpu = (bean.currentThreadCpuTime - cpuBefore) / 1_000_000.0
        val runs = context.regexRuns - runsBefore
        val budget = ListRegex.stepsFor(url.length)
        println("ArdiaBlockingTiming 5000 domain-scoped regex rules on their site: ran %d of 5000, steps used %d of %d, cpu %.2f ms".format(runs, budget - maxOf(context.regexScratch.steps, 0), budget, cpu))
        assertTrue(runs <= budget / ListRegex.STEPS_PER_RULE_CHECK)
        assertTrue("cpu $cpu ms", cpu < 150)
        assertFalse(engine.blocks(url, "https://elsewhere.test/"))
    }

    @Test
    fun theNoTokenCapCountsDistinctRules() {
        val list = (List(128) { "/same/" } + "/ads/").joinToString("\n")
        val parsed = FilterParser.parse(list, "duplicates")
        assertEquals(2, parsed.network.size)
        assertNull(parsed.skipped[SkipReason.UNINDEXED_REGEX])
        assertTrue(engineOf(list).blocks("https://site.test/ads", "https://page.test/"))
        val over = FilterParser.parse((0 until 130).joinToString("\n") { "/q" + it.toString().padStart(3, '0') + "/" } + "\n/q000/", "over")
        assertEquals(ListRegex.MAX_UNINDEXED_PER_LIST, over.network.size)
        assertEquals(2, over.skipped[SkipReason.UNINDEXED_REGEX])
    }

    @Test
    fun aTokenIsOnlyTakenWhenItsNeighboursBreakIt() {
        assertTrue(engineOf("/[[:alpha:]]ads\\./").blocks("https://x.test/xads.", "https://page.test/"))
        assertTrue(engineOf("/\\/ads[[:alpha:]]/").blocks("https://x.test/adsx", "https://page.test/"))
        assertTrue(engineOf("/\u017fads\\./").blocks("https://x.test/sads.", "https://page.test/"))
        assertEquals(emptyList<String>(), Tokens.regexCandidates("[[:alpha:]]ads\\."))
        assertEquals(emptyList<String>(), Tokens.regexCandidates("\u017fads\\."))
        assertEquals(emptyList<String>(), Tokens.regexCandidates("(?:x)?ads\\."))
        assertEquals(listOf("ads"), Tokens.regexCandidates("[[:alpha:]]\\/ads\\."))
        assertEquals(listOf("ads"), Tokens.regexCandidates("\\.ads\\/"))
        assertEquals(16, ListRegex.classEnd("x[[:alpha:]\\]a-z]", 1))
        assertEquals("[(][[:alpha:](]a(?:b)", ListRegex.withoutCaptures("[(][[:alpha:](]a(b)"))
        assertFalse(ListRegex.dependsOnInputEnd("[[:alpha:]$]a"))
    }

    @Test
    fun escapesAndUnicodeCaseFoldingNeverHideAMatch() {
        assertTrue(engineOf("/\\x61bc/\$match-case").blocks("https://x.test/abc", "https://page.test/"))
        assertTrue(engineOf("/kiss/").blocks("https://x.test/ki\u017f\u017f", "https://page.test/"))
        assertTrue(engineOf("/kiss/").blocks("https://x.test/\u212aiss", "https://page.test/"))
        assertTrue(engineOf("/\\.kiss\\./").blocks("https://x.test/a.KI\u017fS.b", "https://page.test/"))
        assertFalse(engineOf("/KISS/\$match-case").blocks("https://x.test/ki\u017f\u017f", "https://page.test/"))
        assertTrue(engineOf("/(?i)KISS/\$match-case").blocks("https://x.test/ki\u017f\u017f", "https://page.test/"))
        assertTrue(engineOf("/\\x{6b}i\\x73s/").blocks("https://x.test/kiss", "https://page.test/"))
        assertEquals('s', RequestContext.foldsToAscii('\u017f'))
        assertEquals('k', RequestContext.foldsToAscii('\u212a'))
        assertEquals(setOf('\u017f', '\u212a'), RequestContext.asciiFoldSources.keys)
    }

    @Test
    fun quotedLiteralsAreRefusedAndOtherGroupFormsKeepTheirMeaning() {
        val quoted = FilterParser.parse("/\\Q(foo)\\E/\n/a\\Q.b/", "quoted")
        assertEquals(0, quoted.network.size)
        assertEquals(2, quoted.skipped[SkipReason.UNSUPPORTED_REGEX])
        fun finds(source: String, input: String, matchCase: Boolean = false) = ListRegex.compile(source, matchCase)!!.matcher(input).find()
        assertTrue(finds("\\(foo\\)", "a(foo)b"))
        assertFalse(finds("\\(foo\\)", "afoob"))
        assertTrue(finds("[(]foo[)]", "a(foo)b"))
        assertFalse(finds("[(]foo[)]", "afoob"))
        assertTrue(finds("[^(]foo", "xfoo"))
        assertTrue(finds("(?P<word>foo)bar", "foobar"))
        assertTrue(finds("(?:foo)+bar", "foofoobar"))
        assertTrue(finds("(?i)FOO", "xfoo", matchCase = true))
        assertFalse(finds("FOO", "xfoo", matchCase = true))
        assertTrue(finds("^https?:\\/\\/(?:www\\.)?(ads|track)\\.", "https://www.track.example/"))
        assertEquals("[(]\\((?:a)(?:b)(?i)(?:c)", ListRegex.withoutCaptures("[(]\\((a)(?:b)(?i)(?P<n>c)"))
        val engine = engineOf("/shop\\/item-[0-9]+\$/")
        assertTrue(engine.blocks("https://a.test/shop/item-12", "https://a.test/"))
        assertFalse(engine.blocks("https://a.test/shop/item-12" + "x".repeat(800), "https://a.test/"))
        assertTrue(engine.blocks("https://a.test/" + "p".repeat(3_000) + "/shop/item-12", "https://a.test/"))
        val endOfInput = engineOf("||a.test^\n@@/^https:\\/\\/a\\.test\\/.*a\\z/")
        assertFalse(endOfInput.blocks("https://a.test/" + "q".repeat(497) + "a", "https://page.test/"))
        assertTrue(endOfInput.blocks("https://a.test/" + "q".repeat(497) + "ab", "https://page.test/"))
        assertTrue(endOfInput.blocks("https://a.test/" + "q".repeat(3_000) + "ab", "https://page.test/"))
        assertFalse(engineOf("/^https:\\/\\/a\\.test\\/.*a\\z/").blocks("https://a.test/" + "q".repeat(497) + "ab", "https://page.test/"))
        assertFalse(engineOf("/^https:\\/\\/a\\.test\\/.*a\\b/").blocks("https://a.test/" + "q".repeat(497) + "ab", "https://page.test/"))
        val huge = "https://a.test/" + "q".repeat(ListRegex.MAX_INPUT_LENGTH) + "a"
        assertFalse(engineOf("/^https:\\/\\/a\\.test\\/.*a\\z/").blocks(huge, "https://page.test/"))
        assertFalse(engineOf("/^https:\\/\\/a\\.test\\/.*q\\b/").blocks(huge, "https://page.test/"))
        assertTrue(engineOf("/^https:\\/\\/a\\.test\\/q/").blocks(huge, "https://page.test/"))
        for (form in listOf("a$", "a\\z", "a\\b", "a\\B", "(?m)a$", "(?s).$")) assertTrue(form, ListRegex.dependsOnInputEnd(form))
        for (form in listOf("[$]a", "a\\$", "a\\\\z", "[\\b]a")) assertFalse(form, ListRegex.dependsOnInputEnd(form))
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
                listOf(NetworkFilter("/long/", false, false, false, Party.ANY, RequestType.SUBRESOURCES, Anchor.NONE, false, null, "a".repeat(9_000), true, emptyList(), emptyList())),
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
