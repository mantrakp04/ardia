package com.ardia.blocking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CosmeticTest {
    private val syntax = engineOf(resource("syntax-sample.txt"))

    @Test
    fun genericSelectorsShareOneStylesheetAndSiteRulesAddToIt() {
        val elsewhere = syntax.hiding("unrelated.test")!!
        val generic = elsewhere.generic.lines().filter { it.isNotBlank() }
        assertEquals(listOf(".ad-banner,#sponsored-box,div[id^=\"google_ads_iframe\"],.card:has(> .sponsored){display:none!important}"), generic)
        assertTrue(elsewhere.generic === syntax.hiding("another.test")!!.generic)
        val shop = syntax.hiding("shop.example.com")!!.selectors()
        assertTrue(".shop-ad" in shop)
        assertTrue(".scoped-mixed" in shop)
        assertFalse(".local-ad" in syntax.hiding("example.com")!!.selectors())
        assertFalse(".scoped-mixed" in syntax.hiding("sub.example.com")!!.selectors())
        assertTrue(".scoped-mixed" in syntax.hiding("www.example.com")!!.selectors())
        assertFalse(".adsbox" in elsewhere.selectors())
        for (absent in listOf("has-text", "selection", "broken", "idn", "tld-entity")) {
            assertTrue(absent, syntax.hiding("example.com")!!.selectors().none { it.contains(absent) })
        }
    }

    @Test
    fun exclusionsAndSiteExceptionsLiftASelectorOnlyWhereTheyApply() {
        assertTrue(".everywhere-but" in syntax.hiding("news.test")!!.selectors())
        assertFalse(".everywhere-but" in syntax.hiding("excluded.example")!!.selectors())
        assertFalse(".everywhere-but" in syntax.hiding("a.excluded.example")!!.selectors())
        assertTrue(".promo-box" in syntax.hiding("random.test")!!.selectors())
        assertTrue(".promo-box" in syntax.hiding("kept.example")!!.selectors())
        val scoped = engineOf("##.promo\nnews.test#@#.promo\n~kept.test##.side")
        assertFalse(".promo" in scoped.hiding("news.test")!!.selectors())
        assertFalse(".promo" in scoped.hiding("live.news.test")!!.selectors())
        assertTrue(".promo" in scoped.hiding("other.test")!!.selectors())
        assertFalse(".side" in scoped.hiding("kept.test")!!.selectors())
        assertTrue(".side" in scoped.hiding("other.test")!!.selectors())
        assertTrue(".promo-box" in syntax.hiding("shop.example")!!.selectors())
        assertTrue(".promo-box" in syntax.hiding("blog.example")!!.selectors())
        val real = engineOf(resource("cookie-sample.txt"), BlockingCategory.COOKIE_BANNERS)
        assertTrue("#CookieBanner" in real.hiding("fruugo.co.nz")!!.selectors())
        assertFalse("#CookieBanner" in real.hiding("news.test")!!.selectors())
    }

    @Test
    fun hidingExceptionsForAPageAreHonoured() {
        assertNull(syntax.hiding("news.example"))
        assertNull(syntax.hiding("trusted.example"))
        val partial = engineOf("##.generic\nsite.test##.specific\n@@||site.test^\$generichide")
        val site = partial.hiding("site.test")!!
        assertEquals("", site.generic)
        assertEquals(setOf(".specific"), site.selectors())
        assertEquals(setOf(".generic"), partial.hiding("other.test")!!.selectors())
    }

    @Test
    fun cookieSelectorsFollowTheirSwitch() {
        val engine = engineOf("##.ad-slot" to BlockingCategory.ADS, "##.cookie-wall" to BlockingCategory.COOKIE_BANNERS)
        val adsOnly = BlockingCategory.ADS.bit or BlockingSettings.OWNER_BIT
        assertEquals(setOf(".ad-slot", ".cookie-wall"), engine.hiding("a.test")!!.selectors())
        assertEquals(setOf(".ad-slot"), engine.hiding("a.test", adsOnly)!!.selectors())
    }

    @Test
    fun myFiltersExceptionsAlsoLiftTheBuiltInHides() {
        val engine = FilterEngine.build(
            SeedRules.sources() + EngineSource(FilterParser.parse("! note\n#@##didomi-host\nexample.com##.ad\n  #@#.qc-cmp2-container  ", FilterLists.MY_FILTERS_ID), null, isOwner = true),
        )
        val selectors = engine.hiding("news.test")!!.selectors()
        assertFalse("#didomi-host" in selectors)
        assertFalse(".qc-cmp2-container" in selectors)
        assertTrue("#onetrust-banner-sdk" in selectors)
        assertTrue("#didomi-host" in FilterEngine.build(SeedRules.sources()).hiding("news.test")!!.selectors())
    }

    @Test
    fun theHidingScriptCarriesTheCssSafely() {
        val script = BlockingScripts.hiding("a[title=\"x\"]{display:none!important}\n</script>")
        assertTrue(script.contains("adoptedStyleSheets"))
        assertTrue(script.contains("a[title=\\\"x\\\"]"))
        assertFalse(script.contains("</script>"))
        assertEquals("", BlockingScripts.hiding(""))
    }

    @Test
    fun theConsentScriptIsTheIphonesWithoutItsMessageHandler() {
        val consent = BlockingScripts.consent
        assertTrue(consent.startsWith("(async () => {"))
        assertTrue(consent.contains("#onetrust-reject-all-handler"))
        assertTrue(consent.contains("uc-deny-all-button"))
        assertFalse(consent.contains("webkit"))
        assertFalse(consent.contains("allowed"))
    }
}
