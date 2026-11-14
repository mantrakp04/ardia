package com.ardia.blocking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterParserTest {
    private val parsed = FilterParser.parse(resource("syntax-sample.txt"), "syntax")

    private fun filter(key: String): NetworkFilter? = parsed.network.firstOrNull { it.key == key }

    @Test
    fun readsTheNetworkSyntaxIntoHostsPatternsAndOptions() {
        assertEquals("hosts.example", filter("||hosts.example^")?.host)
        assertNull(parsed.network.firstOrNull { it.key.contains("localhost") })
        assertEquals("^", filter("||doubleclick.net^")?.pattern)
        assertEquals("ads.upper.example", filter("||ADS.UPPER.example^")?.host)
        assertEquals("xn--bcher-kva.example", filter("||xn--bcher-kva.example^")?.host)
        assertEquals(Party.THIRD, filter("||ads.example.com^\$third-party")?.party)

        val tracker = filter("||tracker.example^\$script,image,domain=news.example|blog.example")!!
        assertEquals(RequestType.SCRIPT.bit or RequestType.IMAGE.bit, tracker.typeMask)
        assertEquals(listOf("news.example", "blog.example"), tracker.includeDomains)

        val guarded = filter("||guarded.example^\$domain=site.example|other.example|~account.site.example")!!
        assertEquals(listOf("site.example", "other.example"), guarded.includeDomains)
        assertEquals(listOf("account.site.example"), guarded.excludeDomains)
        assertNotNull(filter("||walled.example^\$domain=site.example|~account.site.example"))

        assertEquals(RequestType.SUBDOCUMENT.bit, filter("||frames.example^\$subdocument")?.typeMask)
        assertEquals(RequestType.SUBRESOURCES and RequestType.SCRIPT.bit.inv(), filter("||notscript.example^\$~script")?.typeMask)
        assertEquals(RequestType.XHR.bit or RequestType.WEBSOCKET.bit or RequestType.PING.bit, filter("||sockets.example^\$xhr,websocket,ping")?.typeMask)
        assertEquals(RequestType.DOCUMENT.bit, filter("||page.example^\$doc")?.typeMask)

        val cased = filter("||CaseTest.example/Path\$match-case")!!
        assertTrue(cased.matchCase)
        assertEquals("casetest.example", cased.host)
        assertEquals("/Path", cased.pattern)
        assertEquals(RequestType.SCRIPT.bit, filter("||redirect.example/ad.js\$script,redirect=noopjs")?.typeMask)
        assertEquals("/ads/*.js", filter("||path.example/ads/*.js")?.pattern)
        filter("|https://cdn.example/ads/")!!.let {
            assertEquals(Anchor.START, it.anchor)
            assertEquals("https://cdn.example/ads/", it.pattern)
        }
        assertEquals("/banner/*/img^", filter("/banner/*/img^")?.pattern)
        assertTrue(filter("/^https?:\\/\\/ad[0-9]+\\.example\\//\$script")!!.isRegex)
        assertTrue(filter("/ad(s|vert)/")!!.isRegex)
        assertTrue(filter("||important.example^\$important")!!.isImportant)
        assertTrue(filter("@@||cdn.example.com^\$script")!!.isException)

        assertEquals(setOf("||badfilter.example^"), parsed.badfilters)
        assertEquals(listOf("trusted.example"), parsed.documentAllows)
        assertEquals(listOf("news.example"), parsed.elemhideAllows)
        for (absent in listOf("popunder", "csp", "removeparam")) {
            assertTrue(absent, parsed.network.none { it.key.contains(absent) })
        }
        assertNull(filter("ad"))
    }

    @Test
    fun countsEveryLineItCannotHonourByReason() {
        assertEquals(14, parsed.skippedLines)
        assertEquals(1, parsed.skipped[SkipReason.NEVER_APPLIES])
        assertEquals(4, parsed.skipped[SkipReason.UNSUPPORTED_COSMETIC])
        assertEquals(4, parsed.skipped[SkipReason.INVALID_SELECTOR])
        assertEquals(2, parsed.skipped[SkipReason.INVALID_DOMAIN])
        assertEquals(parsed.skippedLines, parsed.skipped.values.sum())
    }

    @Test
    fun cosmeticRulesKeepTheirSitesAndExclusions() {
        val generic = parsed.cosmetic.filter { !it.isException && it.includeDomains.isEmpty() && it.excludeDomains.isEmpty() }.map { it.selector }
        assertEquals(listOf(".ad-banner", "#sponsored-box", "div[id^=\"google_ads_iframe\"]", ".card:has(> .sponsored)", ".promo-box", ".adsbox"), generic)
        val scopedMixed = parsed.cosmetic.first { it.selector == ".scoped-mixed" }
        assertEquals(listOf("example.com"), scopedMixed.includeDomains)
        assertEquals(listOf("sub.example.com"), scopedMixed.excludeDomains)
        val notHere = parsed.cosmetic.first { it.selector == ".never-excepted" }
        assertTrue(notHere.isException)
        assertEquals(listOf("excluded.example"), notHere.excludeDomains)
        for (absent in listOf("has-text", "selection", "broken", "procedural", "inject", "idn", "tld-entity", "-abp-has")) {
            assertTrue(absent, parsed.cosmetic.none { it.selector.contains(absent) })
        }
    }

    @Test
    fun regexRulesAreIndexedByTheLiteralsTheyMustContain() {
        assertEquals(listOf("104", "154"), Tokens.regexCandidates("(https?:\\/\\/)104\\.154\\..{100,}"))
        assertEquals(listOf("invoke"), Tokens.regexCandidates("\\/[0-9a-f]{32}\\/invoke\\.js"))
        assertEquals(listOf("me"), Tokens.regexCandidates("(https?:\\/\\/)\\w{30,}\\.me\\/\\w{30,}\\."))
        assertEquals(listOf("https", "cdn", "jsdelivr", "net", "npm", "latest", "dist", "script", "min", "js"),
            Tokens.regexCandidates("^https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/[-a-z_]{4,22}@latest\\/dist\\/script\\.min\\.js$"))
        assertEquals(emptyList<String>(), Tokens.regexCandidates("ad(s|vert)"))
        assertEquals(emptyList<String>(), Tokens.regexCandidates("^https?:\\/\\/[a-z]{10,}\\.(cfd|click)\\/\\d{6,}"))
        assertEquals(emptyList<String>(), Tokens.regexCandidates("\\/ads?\\/"))
        assertEquals(emptyList<String>(), Tokens.regexCandidates("\\/(?=x)ads\\/"))
        val engine = engineOf("/(https?:\\/\\/)104\\.154\\..{20,}/")
        assertTrue(engine.blocks("https://104.154.12.9/" + "x".repeat(30), "https://a.test/"))
        assertFalse(engine.blocks("https://104.154.12.9/short", "https://a.test/"))
        assertEquals(0, engine.stats.unindexedRules)
    }

    @Test
    fun selectorsAreValidatedLikeTheIphone() {
        val cases = listOf(
            ".a > .b:not(.c)" to true,
            "div[class*=\"x:y\"]" to true,
            ".a:nth-child(2n+1)" to true,
            ".a:has(.b)" to true,
            ".a:hover" to false,
            ".a::before" to false,
            "div[title='x]" to false,
            ".a)(" to false,
            ".a { color: red }" to false,
            "a\u0007b" to false,
        )
        for ((selector, valid) in cases) assertEquals(selector, valid, FilterParser.isValidSelector(selector))
    }

    @Test
    fun realListsParseWithFewSkips() {
        for (name in listOf("easylist-sample.txt", "easyprivacy-sample.txt", "cookie-sample.txt")) {
            val list = FilterParser.parse(resource(name), name)
            assertTrue("$name converted ${list.convertedLines}", list.convertedLines > 150)
            assertTrue("$name skipped ${list.skipped}", list.skippedLines * 20 < list.convertedLines)
        }
    }

    @Test
    fun compiledFormRoundTripsWithoutReparsing() {
        TempDirectory().use { directory ->
            val file = java.io.File(directory.file, "list.bin")
            val original = FilterParser.parse(resource("easylist-sample.txt") + "\n" + resource("syntax-sample.txt"), "easylist")
            CompiledListFile.write(file, original, 123, 456)
            val restored = CompiledListFile.read(file, 123, 456)!!
            assertEquals(original.convertedLines, restored.convertedLines)
            assertEquals(original.skipped, restored.skipped)
            assertEquals(original.network.map { listOf(it.key, it.host, it.pattern, it.typeMask, it.party, it.includeDomains, it.excludeDomains) },
                restored.network.map { listOf(it.key, it.host, it.pattern, it.typeMask, it.party, it.includeDomains, it.excludeDomains) })
            assertEquals(original.cosmetic.map { listOf(it.selector, it.isException, it.includeDomains, it.excludeDomains) },
                restored.cosmetic.map { listOf(it.selector, it.isException, it.includeDomains, it.excludeDomains) })
            assertEquals(original.badfilters, restored.badfilters)
            assertEquals(original.documentAllows + original.elemhideAllows, restored.documentAllows + restored.elemhideAllows)
            assertNull(CompiledListFile.read(file, 124, 456))
            assertNull(CompiledListFile.read(file, 123, 457))
            file.writeBytes(file.readBytes().copyOf(200))
            assertNull(CompiledListFile.read(file, 123, 456))
            assertFalse(java.io.File(directory.file, "list.bin.tmp").exists())
        }
    }
}
