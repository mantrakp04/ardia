package com.ardia.blocking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MatcherTest {
    private val syntax = engineOf(resource("syntax-sample.txt").lines().filterNot { it == "/ad(s|vert)/" }.joinToString("\n"))
    private val real = engineOf(
        resource("easylist-sample.txt") to BlockingCategory.ADS,
        resource("easyprivacy-sample.txt") to BlockingCategory.TRACKERS,
        resource("cookie-sample.txt") to BlockingCategory.COOKIE_BANNERS,
    )

    @Test
    fun hostAnchorsMatchTheHostAndItsSubdomainsOnly() {
        assertTrue(syntax.blocks("https://doubleclick.net/ad", "https://news.test/"))
        assertTrue(syntax.blocks("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "https://news.test/"))
        assertTrue(syntax.blocks("https://DoubleClick.NET:443/x?y=1", "https://news.test/"))
        assertFalse(syntax.blocks("https://notdoubleclick.net/ad", "https://news.test/"))
        assertFalse(syntax.blocks("https://doubleclick.net.evil.test/ad", "https://news.test/"))
        assertTrue(syntax.blocks("http://hosts.example/x", "https://news.test/"))
        assertTrue(syntax.blocks("https://ads.upper.example/", null))
        assertTrue(syntax.blocks("https://xn--bcher-kva.example/", null))
        assertFalse(syntax.blocks("data:text/plain,doubleclick.net", "https://news.test/"))
        assertFalse(syntax.blocks("blob:https://doubleclick.net/abc", "https://news.test/"))
    }

    @Test
    fun patternsHonourWildcardsAnchorsAndSeparators() {
        assertTrue(syntax.blocks("https://path.example/ads/x/y.js", "https://a.test/"))
        assertFalse(syntax.blocks("https://path.example/other/x.js", "https://a.test/"))
        assertTrue(syntax.blocks("https://cdn.example/ads/1.png", "https://a.test/"))
        assertFalse(syntax.blocks("http://cdn.example/ads/1.png", "https://a.test/"))
        assertFalse(syntax.blocks("https://other.test/?u=https://cdn.example/ads/1.png", "https://a.test/"))
        assertTrue(syntax.blocks("https://shop.example/banner/product/img", "https://a.test/"))
        assertTrue(syntax.blocks("https://shop.example/banner/product/img?size=2", "https://a.test/"))
        assertTrue(syntax.blocks("https://shop.example/banner/product/img/1.png", "https://a.test/"))
        assertFalse(syntax.blocks("https://shop.example/banner/product/imgallery.jpg", "https://a.test/"))
        assertFalse(syntax.blocks("https://shop.example/banner/product/img.png", "https://a.test/"))
        assertTrue(syntax.blocks("https://casetest.example/Path", "https://a.test/"))
        assertFalse(syntax.blocks("https://casetest.example/path", "https://a.test/"))
        assertTrue(syntax.blocks("https://ad12.example/x.js", "https://a.test/"))
        assertFalse(syntax.blocks("https://ad12.example/x.png", "https://a.test/"))
        assertFalse(syntax.blocks("https://adx.example/x.js", "https://a.test/"))
        val alternation = engineOf("/ad(s|vert)/")
        assertTrue(alternation.blocks("https://site.test/advert/x", "https://a.test/"))
        assertFalse(alternation.blocks("https://site.test/adverb/x", "https://a.test/"))
        assertTrue(real.blocks("https://cdn.site.com/b.js", "https://a.test/"))
        assertFalse(real.blocks("https://cdn.site.com/b.js?v=2", "https://a.test/"))
    }

    @Test
    fun typesAreHonouredOnlyWhenTheRequestTellsThem() {
        assertTrue(syntax.blocks("https://tracker.example/t.js", "https://news.example/"))
        assertFalse(syntax.blocks("https://tracker.example/t.css", "https://news.example/"))
        assertFalse(syntax.blocks("https://tracker.example/collect", "https://news.example/"))
        assertTrue(syntax.blocks("https://tracker.example/collect", "https://news.example/", type = RequestType.IMAGE))
        assertFalse(syntax.blocks("https://frames.example/f", "https://a.test/"))
        assertTrue(syntax.blocks("https://frames.example/f", "https://a.test/", type = RequestType.SUBDOCUMENT))
        assertTrue(syntax.blocks("https://notscript.example/a.png", "https://a.test/"))
        assertFalse(syntax.blocks("https://notscript.example/a.js", "https://a.test/"))
        assertFalse(syntax.blocks("https://notscript.example/a", "https://a.test/"))
        assertTrue(syntax.blocks("wss://sockets.example/live", "https://a.test/"))
        assertTrue(syntax.blocks("https://page.example/", null, mainFrame = true))
        assertFalse(syntax.blocks("https://page.example/x.png", "https://a.test/"))
        assertFalse(syntax.blocks("https://doubleclick.net/", null, mainFrame = true))
        assertFalse(syntax.blocks("https://popunder.example/", "https://a.test/"))
        assertFalse(syntax.blocks("https://popunder.example/", null, mainFrame = true))
    }

    @Test
    fun thirdPartyComparesSitesByThePublicSuffixList() {
        assertTrue(syntax.blocks("https://ads.example.com/x.js", "https://news.test/"))
        assertFalse(syntax.blocks("https://ads.example.com/x.js", "https://www.example.com/"))
        assertFalse(syntax.blocks("https://ads.example.com/x.js", null))
        assertTrue(real.blocks("https://cdn.linksynergy.com/a.gif", "https://shop.co.uk/"))
        assertFalse(real.blocks("https://cdn.linksynergy.com/a.gif", "https://www.linksynergy.com/"))
        assertEquals("bbc.co.uk", PublicSuffixes.shared.registrableDomain("news.bbc.co.uk"))
        assertEquals("user.github.io", PublicSuffixes.shared.registrableDomain("a.user.github.io"))
        assertEquals("example.com", PublicSuffixes.shared.registrableDomain("example.com"))
        assertEquals("192.168.0.1", PublicSuffixes.shared.registrableDomain("192.168.0.1"))
        assertTrue(real.blocks("https://cdn.linksynergy.com/a.gif", "https://alice.github.io/"))
        assertFalse(real.blocks("https://alice.github.io/linksynergy.com/a.gif", "https://alice.github.io/"))
    }

    @Test
    fun domainOptionsUseTheMostSpecificSite() {
        assertTrue(syntax.blocks("https://mixed.example/x", "https://a.example/"))
        assertFalse(syntax.blocks("https://mixed.example/x", "https://b.example/"))
        assertTrue(syntax.blocks("https://guarded.example/x", "https://site.example/"))
        assertTrue(syntax.blocks("https://guarded.example/x", "https://www.site.example/"))
        assertFalse(syntax.blocks("https://guarded.example/x", "https://account.site.example/"))
        assertFalse(syntax.blocks("https://guarded.example/x", "https://deep.account.site.example/"))
        assertTrue(syntax.blocks("https://guarded.example/x", "https://other.example/"))
        assertFalse(syntax.blocks("https://guarded.example/x", "https://unrelated.example/"))
        assertTrue(syntax.blocks("https://walled.example/x", "https://site.example/"))
        assertFalse(syntax.blocks("https://walled.example/x", "https://account.site.example/"))
        assertTrue(real.blocks("https://ad.mail.ru/banner.js", "https://news.test/"))
        assertFalse(real.blocks("https://ad.mail.ru/banner.js", "https://mail.ru/"))
        assertFalse(real.blocks("https://ad.mail.ru/banner.js", "https://m.sportmail.ru/"))
        assertFalse(real.blocks("https://ad.mail.ru/banner.png", "https://news.test/"))
        assertTrue(real.blocks("https://shop.net/wp-ads-manager/x.png", "https://news.test/"))
        assertFalse(real.blocks("https://shop.net/wp-ads-manager/x.png", "https://make.wordpress.org/"))
        assertTrue(real.blocks("https://cdn.foo.com/ad/x.js", "https://bar.net/"))
        assertFalse(real.blocks("https://cdn.foo.com/ad/x.js", "https://www.espn.com/"))
        assertFalse(real.blocks("https://cdn.foo.com/ad/x.png", "https://bar.net/"))
    }

    @Test
    fun exceptionsWinUnlessTheBlockIsImportant() {
        assertTrue(real.blocks("https://www.googletagmanager.com/gtm.js?id=GTM-1", "https://news.test/"))
        assertFalse(real.blocks("https://www.googletagmanager.com/gtm.js?id=GTM-1", "https://9to5mac.com/"))
        assertTrue(real.blocks("https://www.google-analytics.com/analytics.js", "https://news.test/"))
        assertFalse(real.blocks("https://www.google-analytics.com/analytics.js", "https://jackbox.tv/"))
        assertTrue(real.blocks("https://www.google-analytics.com/analytics.js", "https://mond.how/"))
        assertTrue(real.blocks("https://www.googletagmanager.com/gtag/js?id=G-1", "https://redstoneonline.jp/", type = RequestType.SCRIPT))
        assertFalse(real.blocks("https://www.googletagmanager.com/gtag/js?id=G-1", "https://www.cnet.com/", type = RequestType.SCRIPT))
        assertFalse(real.blocks("https://www.googletagmanager.com/gtag/js?id=G-1", "https://redstoneonline.jp/"))
        assertTrue(real.blocks("https://s0.2mdn.net/instream/html5/ima3.js", "https://news.test/"))
        assertFalse(real.blocks("https://s0.2mdn.net/instream/html5/ima3.js", "https://www.zdnet.com/"))
        assertFalse(real.blocks("https://s0.2mdn.net/videoplayback/clip.mp4", "https://news.test/"))
        assertTrue(syntax.blocks("https://important.example/x", "https://a.test/"))
        assertFalse(syntax.blocks("https://badfilter.example/x", "https://a.test/"))
    }

    @Test
    fun aDocumentExceptionTurnsBlockingOffForTheWholePage() {
        assertTrue(syntax.blocks("https://doubleclick.net/x", "https://news.test/"))
        assertFalse(syntax.blocks("https://doubleclick.net/x", "https://trusted.example/"))
        assertFalse(syntax.blocks("https://doubleclick.net/x", "https://shop.trusted.example/"))
        assertTrue(real.blocks("https://cdn.site.com/smartpop/go", null, mainFrame = true))
    }

    @Test
    fun myFiltersWinOverListsInBothDirections() {
        val engine = engineOf(
            "||tracker.example^\n@@||ads.example^\n##.promo" to BlockingCategory.ADS,
            mine = "||ads.example^\n@@||tracker.example^\n#@#.promo\nnews.example##.paywall",
        )
        assertFalse(engine.blocks("https://tracker.example/x", "https://a.test/"))
        assertTrue(engine.blocks("https://ads.example/x", "https://a.test/"))
        val news = engine.hiding("news.example")!!.selectors()
        assertTrue(".paywall" in news)
        assertFalse(".promo" in news)
        val listImportant = engineOf("||cdn.example^\$important" to BlockingCategory.ADS, mine = "@@||cdn.example^")
        assertTrue(listImportant.blocks("https://cdn.example/x", "https://a.test/"))
    }

    @Test
    fun switchedOffCategoriesStopBlockingButExceptionsStillApply() {
        val adsOnly = BlockingCategory.ADS.bit or BlockingSettings.OWNER_BIT
        val trackersOnly = BlockingCategory.TRACKERS.bit or BlockingSettings.OWNER_BIT
        assertTrue(real.blocks("https://000491b06a.com/x", "https://a.test/", mask = adsOnly))
        assertFalse(real.blocks("https://000491b06a.com/x", "https://a.test/", mask = trackersOnly))
        assertFalse(real.blocks("https://www.googletagmanager.com/gtm.js", "https://a.test/", mask = adsOnly))
        assertTrue(real.blocks("https://www.googletagmanager.com/gtm.js", "https://a.test/", mask = trackersOnly))
        assertFalse(real.blocks("https://www.googletagmanager.com/gtm.js", "https://9to5mac.com/", mask = trackersOnly))
    }

    @Test
    fun seedsBlockBeforeAnyListIsDownloaded() {
        val seeds = FilterEngine.build(SeedRules.sources())
        assertTrue(seeds.blocks("https://securepubads.g.doubleclick.net/gpt.js", "https://news.test/"))
        assertTrue(seeds.blocks("https://www.google-analytics.com/g/collect", "https://news.test/"))
        assertFalse(seeds.blocks("https://www.google-analytics.com/g/collect", "https://google-analytics.com/"))
        assertFalse(seeds.blocks("https://example.com/app.js", "https://news.test/"))
        assertTrue("#onetrust-banner-sdk" in seeds.hiding("news.test")!!.selectors())
    }

    @Test
    fun theIndexLeavesAlmostNothingToScan() {
        val stats = real.stats
        assertTrue("unindexed ${stats.unindexedRules} of ${stats.blockRules}", stats.unindexedRules * 50 < stats.blockRules + stats.exceptionRules)
    }
}
