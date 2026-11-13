package com.ardia.blocking

import java.io.File
import java.lang.management.ManagementFactory
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MatcherSpeedTest {
    private val requests = listOf(
        "https://securepubads.g.doubleclick.net/tag/js/gpt.js" to "https://www.theguardian.com/world/2026/nov/12/story",
        "https://www.googletagmanager.com/gtm.js?id=GTM-ABC123&l=dataLayer" to "https://www.theguardian.com/world",
        "https://www.google-analytics.com/g/collect?v=2&tid=G-XXXX&gtm=45je4b&_p=1731400000&cid=123.456&ul=en-us&sr=1080x2400&uaa=arm&uab=64&_s=1&dl=https%3A%2F%2Fexample.com%2F&dt=Example" to "https://example.com/",
        "https://assets.guim.co.uk/assets/vendors~commercial.6b1c2e.js" to "https://www.theguardian.com/",
        "https://i.guim.co.uk/img/media/abc/0_0_3000_1800/master/3000.jpg?width=620&quality=85&auto=format&fit=max&s=1a2b3c" to "https://www.theguardian.com/",
        "https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2" to "https://news.ycombinator.com/",
        "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js" to "https://codepen.io/pen",
        "https://ib.adnxs.com/ut/v3/prebid" to "https://www.cnn.com/2026/11/12/politics/index.html",
        "https://c.amazon-adsystem.com/aax2/apstag.js" to "https://www.cnn.com/",
        "https://static.chartbeat.com/js/chartbeat.js" to "https://www.cnn.com/",
        "https://www.reddit.com/svc/shreddit/events" to "https://www.reddit.com/r/android/",
        "https://styles.redditmedia.com/t5_2qlqh/styles/communityIcon_abc.png" to "https://www.reddit.com/r/android/",
        "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890" to "https://stackoverflow.com/questions/1",
        "https://cdn.sstatic.net/Js/stub.en.js?v=abc" to "https://stackoverflow.com/questions/1",
        "https://connect.facebook.net/en_US/fbevents.js" to "https://shop.example.co.uk/basket",
        "https://www.facebook.com/tr/?id=123&ev=PageView&dl=https%3A%2F%2Fshop.example.co.uk" to "https://shop.example.co.uk/basket",
        "https://cdn.cookielaw.org/scripttemplates/otSDKStub.js" to "https://www.bbc.co.uk/news",
        "https://static.files.bbci.co.uk/core/bundle-service-bar.003e2cd.js" to "https://www.bbc.co.uk/news",
        "https://ichef.bbci.co.uk/news/480/cpsprodpb/abc/production/_1234_image.jpg.webp" to "https://www.bbc.co.uk/news",
        "https://api.github.com/repos/ardia/ardia/issues?state=open&per_page=100" to "https://github.com/ardia",
        "https://avatars.githubusercontent.com/u/123456?s=64&v=4" to "https://github.com/ardia",
        "https://www.youtube.com/s/player/abc123/player_ias.vflset/en_US/base.js" to "https://www.youtube.com/watch?v=xyz",
        "https://www.youtube.com/api/stats/ads?ver=2&ns=yt&event=2&device=1&content_v=xyz" to "https://www.youtube.com/watch?v=xyz",
        "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1731400000&ei=abc&ip=1.2.3.4&id=o-abc&itag=243&source=youtube&requiressl=yes" to "https://www.youtube.com/watch?v=xyz",
        "https://example.org/wp-content/plugins/ad-inserter/js/ad-inserter.js?ver=2.7" to "https://example.org/blog/post",
        "https://example.org/wp-content/themes/twentytwenty/style.css?ver=1.2" to "https://example.org/blog/post",
        "https://tr.snapchat.com/p" to "https://store.example.com/",
        "https://bat.bing.com/action/0?ti=123&Ver=2&mid=abc&sid=def&vid=ghi&vids=1&msclkid=N&pi=0&lg=en-US" to "https://store.example.com/",
        "https://sb.scorecardresearch.com/b?c1=2&c2=123&ns__t=1731400000" to "https://www.nytimes.com/",
        "https://static01.nyt.com/images/2026/11/12/multimedia/abc-superJumbo.jpg?quality=75&auto=webp" to "https://www.nytimes.com/",
    )

    @Test
    fun matchingStaysInMicrosecondsWithTheBigListsLoaded() {
        val loaded = loadBigLists()
        val engine = loaded.engine
        val stats = engine.stats
        repeat(20_000) { index -> request(engine, index) }
        val runs = 200_000
        val samples = LongArray(runs)
        val bean = ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean
        val thread = Thread.currentThread().id
        val regexRunsBefore = RequestContext.current().regexRuns
        val allocatedBefore = bean.getThreadAllocatedBytes(thread)
        var blocked = 0
        val started = System.nanoTime()
        for (index in 0 until runs) {
            val begin = System.nanoTime()
            if (request(engine, index)) blocked++
            samples[index] = System.nanoTime() - begin
        }
        val elapsed = System.nanoTime() - started
        val allocated = bean.getThreadAllocatedBytes(thread) - allocatedBefore
        val regexRuns = RequestContext.current().regexRuns - regexRunsBefore
        samples.sort()
        val mean = elapsed / runs / 1000.0
        val median = samples[runs / 2] / 1000.0
        val p99 = samples[runs * 99 / 100] / 1000.0
        val worst = samples[runs - 1] / 1000.0
        println(
            "ArdiaBlockingTiming lists=${loaded.description} parse=${loaded.parseMillis}ms build=${loaded.buildMillis}ms " +
                "rules block=${stats.blockRules} important=${stats.importantRules} exception=${stats.exceptionRules} unindexed=${stats.unindexedRules} " +
                "selectors generic=${stats.genericSelectors} scoped=${stats.scopedSelectors}",
        )
        println(
            "ArdiaBlockingTiming blocks(): mean=%.2fus median=%.2fus p99=%.2fus max=%.1fus blocked=%d/%d allocated=%.1f bytes/call regexRuns=%d"
                .format(mean, median, p99, worst, blocked, runs, allocated.toDouble() / runs, regexRuns),
        )
        val perUrl = requests.indices.map { index ->
            val times = LongArray(2_000)
            for (run in times.indices) {
                val begin = System.nanoTime()
                request(engine, index)
                times[run] = System.nanoTime() - begin
            }
            times.sort()
            Triple(index, times[0] / 1000.0, times[times.size / 2] / 1000.0)
        }
        for ((index, best, middle) in perUrl.sortedByDescending { it.third }.take(6)) {
            val context = RequestContext.current()
            val runsBefore = context.regexRuns
            request(engine, index)
            val regexRuns = context.regexRuns - runsBefore
            val globSteps = RequestContext.GLOB_STEPS_PER_REQUEST - context.globSteps
            println(
                "ArdiaBlockingTiming slowest url best=%.2fus median=%.2fus regexRuns=%d globSteps=%d %s"
                    .format(best, middle, regexRuns, globSteps, requests[index].first.take(90)),
            )
        }
        val slowestBest = perUrl.maxOf { it.second }
        val css = engine.hiding("www.theguardian.com")!!
        println("ArdiaBlockingTiming generic css=${css.generic.length} chars, site css=${css.specific.length} chars")
        assertTrue("median $median us", median < 25.0)
        assertTrue("slowest url at best $slowestBest us", slowestBest < 50.0)
        assertTrue("slowest url median ${perUrl.maxOf { it.third }} us", perUrl.maxOf { it.third } < 100.0)
        assertTrue("allocated ${allocated / runs} bytes per call", allocated / runs < 64)
    }

    @Test
    fun manyThreadsGetTheSameAnswersAsOne() {
        val engine = loadBigLists().engine
        val settings = BlockingSettings(InMemoryBlockingStore())
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val directory = TempDirectory()
        val blocker = ContentBlocker(settings, FilterLists(directory.file, InMemoryBlockingStore(), FakeDownloader(), scope = scope), scope)
        val expected = requests.map { (url, page) -> engine.blocks(url, page) }
        val seedExpected = requests.map { (url, page) -> blocker.blocks(url, page, false) }
        val threads = 8
        val pool = Executors.newFixedThreadPool(threads + 1)
        val ready = CountDownLatch(threads + 1)
        val mismatches = AtomicInteger()
        val calls = AtomicInteger()
        try {
            repeat(threads) { worker ->
                pool.execute {
                    ready.countDown()
                    ready.await()
                    for (round in 0 until 3_000) {
                        val index = (round + worker) % requests.size
                        val (url, page) = requests[index]
                        if (engine.blocks(url, page) != expected[index]) mismatches.incrementAndGet()
                        if (blocker.blocks(url, page, false) != seedExpected[index]) mismatches.incrementAndGet()
                        if (round % 50 == 0) blocker.scriptsAtDocumentStart(page)
                        calls.addAndGet(2)
                    }
                }
            }
            pool.execute {
                ready.countDown()
                ready.await()
                repeat(500) { settings.setExempt("unrelated-$it.test", it % 2 == 0) }
            }
            pool.shutdown()
            assertTrue(pool.awaitTermination(120, TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
            scope.cancel()
            directory.close()
        }
        println("ArdiaBlockingTiming concurrent calls=${calls.get()} mismatches=${mismatches.get()}")
        assertEquals(0, mismatches.get())
        assertEquals(threads * 3_000 * 2, calls.get())
    }

    private fun request(engine: FilterEngine, index: Int): Boolean {
        val (url, page) = requests[index % requests.size]
        return engine.blocks(url, page)
    }

    private class Loaded(val engine: FilterEngine, val description: String, val parseMillis: Long, val buildMillis: Long)

    private fun loadBigLists(): Loaded {
        val directory = System.getProperty("ardia.blockingLists")?.let(::File)?.takeIf { it.isDirectory }
        val texts = if (directory != null) {
            listOf("easylist.txt" to BlockingCategory.ADS, "easyprivacy.txt" to BlockingCategory.TRACKERS, "fanboy-cookiemonster.txt" to BlockingCategory.COOKIE_BANNERS)
                .map { (name, category) -> File(directory, name).readText() to category }
        } else {
            synthesizedLists()
        }
        val parseStart = System.nanoTime()
        val sources = texts.mapIndexed { index, (text, category) -> EngineSource(FilterParser.parse(text, "big$index"), category) }
        val parseMillis = (System.nanoTime() - parseStart) / 1_000_000
        val buildStart = System.nanoTime()
        val engine = FilterEngine.build(SeedRules.sources() + sources)
        val buildMillis = (System.nanoTime() - buildStart) / 1_000_000
        val description = if (directory != null) "real(${sources.sumOf { it.list.convertedLines }} rules)" else "synthesized(${sources.sumOf { it.list.convertedLines }} rules)"
        return Loaded(engine, description, parseMillis, buildMillis)
    }

    private fun synthesizedLists(): List<Pair<String, BlockingCategory>> {
        val random = java.util.Random(7)
        fun word(length: Int) = buildString { repeat(length) { append(('a' + random.nextInt(26))) } }
        val tlds = listOf("com", "net", "org", "io", "co.uk", "de", "xyz")
        val ads = StringBuilder(resource("easylist-sample.txt"))
        repeat(45_000) { ads.append("\n||").append(word(6 + random.nextInt(8))).append('.').append(tlds[random.nextInt(tlds.size)]).append('^') }
        repeat(4_000) { ads.append("\n/").append(word(4 + random.nextInt(6))).append("/ads/").append(word(5)).append(".js") }
        repeat(3_000) { ads.append("\n-").append(word(5 + random.nextInt(5))).append("-banner.\$image") }
        repeat(12_000) { ads.append("\n##.").append(word(6 + random.nextInt(8))) }
        repeat(9_000) { ads.append("\n").append(word(7)).append(".com##.").append(word(8)) }
        val privacy = StringBuilder(resource("easyprivacy-sample.txt"))
        repeat(50_000) { privacy.append("\n||").append(word(5 + random.nextInt(10))).append('.').append(tlds[random.nextInt(tlds.size)]).append("^\$third-party") }
        repeat(5_000) { privacy.append("\n/").append(word(6)).append("/collect?") }
        val cookies = StringBuilder(resource("cookie-sample.txt"))
        repeat(15_000) { cookies.append("\n##.").append(word(6 + random.nextInt(8))) }
        repeat(7_000) { cookies.append("\n").append(word(7)).append(".de##.").append(word(8)) }
        return listOf(ads.toString() to BlockingCategory.ADS, privacy.toString() to BlockingCategory.TRACKERS, cookies.toString() to BlockingCategory.COOKIE_BANNERS)
    }
}
