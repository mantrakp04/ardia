package com.ardia.blocking

import java.io.File
import java.lang.management.ManagementFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RegexComparisonTest {
    private class RegexRule(val line: String, val source: String, val matchCase: Boolean)

    private fun regexRules(): Pair<String, List<RegexRule>> {
        val rules = ArrayList<RegexRule>()
        for (raw in resource("default-list-regex-rules.txt").lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            var body = line.removePrefix("@@")
            var options = ""
            val dollar = body.lastIndexOf('$')
            if (dollar >= 0 && body.substring(dollar + 1).all { it.isLetterOrDigit() || it in ",=|~._-*" } && dollar + 1 < body.length) {
                options = body.substring(dollar + 1)
                body = body.substring(0, dollar)
            }
            if (body.length > 2 && body.startsWith("/") && body.endsWith("/")) {
                rules += RegexRule(line, body.substring(1, body.length - 1), options.split(',').contains("match-case"))
            }
        }
        return "default lists" to rules
    }

    private val corpus = listOf(
        "https://104.154.12.9/" + "x".repeat(120),
        "https://51.195.31.7/" + "y".repeat(140),
        "https://cdn.jsdelivr.net/npm/abcd-ef@latest/dist/script.min.js",
        "https://abcdefghijkl.click/1234567/1234567/a",
        "https://www.abcdefgh12.com/ab.js",
        "https://cdn.test/" + "0123456789abcdef".repeat(2) + "/invoke.js",
        "https://" + "q".repeat(31) + ".me/" + "r".repeat(31) + ".js",
        "https://s3.us-east-1.amazonaws.com/" + "a".repeat(46) + "/abcdef12",
        "https://ad12.example/x.js",
        "https://site.test/advert/x",
        "https://example.com/wp-content/plugins/complianz-gdpr-premium/cookiebanner/js/x.js",
        "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
        "https://www.google-analytics.com/g/collect?v=2&tid=G-XXXX&cid=1.2",
        "https://i.guim.co.uk/img/media/abc/master/3000.jpg?width=620&quality=85",
        "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1731400000&ei=abc&ip=1.2.3.4",
        "https://www.youtube.com/api/stats/ads?ver=2&ns=yt&event=2",
        "http://123.45.67.89/" + "z".repeat(200),
        "https://example.org/a.php?ad=1",
    )

    @Test
    fun re2AcceptsTheRealRegexRulesAndMatchesThemLikeJava() {
        val (source, rules) = regexRules()
        val javaOk = rules.filter { rule -> runCatching { java.util.regex.Pattern.compile(rule.source) }.isSuccess }
        val re2Ok = rules.filter { ListRegex.compile(it.source, it.matchCase) != null }
        val refusedNow = javaOk.filter { rule -> re2Ok.none { it === rule } }
        println("ArdiaBlockingRegex $source: regex rules=${rules.size} java=${javaOk.size} re2=${re2Ok.size}")
        refusedNow.forEach { println("ArdiaBlockingRegex accepted by java.util.regex, refused by RE2/J: ${it.line.take(160)}") }
        rules.filter { rule -> javaOk.none { it === rule } }.forEach { println("ArdiaBlockingRegex refused by both: ${it.line.take(160)}") }

        val both = re2Ok.filter { rule -> javaOk.any { it === rule } }
        var matchedPairs = 0
        val mismatches = ArrayList<String>()
        for (rule in both) {
            val flags = if (rule.matchCase) 0 else java.util.regex.Pattern.CASE_INSENSITIVE
            val java = java.util.regex.Pattern.compile(rule.source, flags)
            val re2 = ListRegex.compile(rule.source, rule.matchCase)!!
            for (url in corpus) {
                val expected = java.matcher(url).find()
                if (expected) matchedPairs++
                if (re2.matcher(url).find() != expected) mismatches += "${rule.line.take(100)} on $url"
            }
        }
        println("ArdiaBlockingRegex corpus=${corpus.size} urls, rule/url pairs that match=$matchedPairs, java vs RE2/J mismatches=${mismatches.size}")
        mismatches.forEach { println("ArdiaBlockingRegex mismatch: $it") }
        assertEquals(emptyList<String>(), mismatches)
        val blockRules = both.filter { !it.line.startsWith("@@") }
        val engine = engineOf(blockRules.joinToString("\n") { "/${it.source}/" + if (it.matchCase) "\$match-case" else "" })
        val engineMismatches = corpus.filter { url ->
            val expected = blockRules.any { rule ->
                java.util.regex.Pattern.compile(rule.source, if (rule.matchCase) 0 else java.util.regex.Pattern.CASE_INSENSITIVE).matcher(url).find()
            }
            engine.blocks(url, "https://page.test/") != expected
        }
        println("ArdiaBlockingRegex engine with ${blockRules.size} real regex block rules vs java on the corpus: mismatches=${engineMismatches.size}")
        assertEquals(emptyList<String>(), engineMismatches)
        assertTrue(matchedPairs > 0)
    }

    @Test
    fun meteredMatchingCostsStaySmallAtEngineBuildAndPerMatch() {
        val (source, rules) = regexRules()
        val runtime = Runtime.getRuntime()
        System.gc()
        val before = runtime.totalMemory() - runtime.freeMemory()
        val started = System.nanoTime()
        val compiled = rules.mapNotNull { rule -> ListRegex.compile(rule.source, rule.matchCase)?.let { it to MeteredRegex(it) } }
        val compileMillis = (System.nanoTime() - started) / 1_000_000.0
        System.gc()
        val retained = runtime.totalMemory() - runtime.freeMemory() - before
        val programs = compiled.map { it.second.size }.sorted()
        println(
            "ArdiaBlockingRegex $source: compiled ${compiled.size} rules in %.1f ms, program size median=%d p90=%d p99=%d max=%d, retained about %d KB"
                .format(compileMillis, programs[programs.size / 2], programs[programs.size * 9 / 10], programs[programs.size * 99 / 100], programs.last(), retained / 1024),
        )
        val scratch = RegexScratch()
        val texts = corpus.map { it.toCharArray() }
        val matchers = compiled.map { it.second }.toTypedArray()
        val inputs = texts.toTypedArray()
        fun runAll() {
            for (rule in matchers.indices) {
                for (input in inputs.indices) {
                    scratch.steps = ListRegex.stepsFor(inputs[input].size)
                    matchers[rule].find(inputs[input], inputs[input].size, scratch)
                }
            }
        }
        repeat(3) { runAll() }
        val bean = ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean
        val thread = Thread.currentThread().id
        val allocatedBefore = bean.getThreadAllocatedBytes(thread)
        val cpuStart = bean.currentThreadCpuTime
        repeat(5) { runAll() }
        val runs = 5 * compiled.size * texts.size
        val perMatch = (bean.currentThreadCpuTime - cpuStart) / runs / 1000.0
        val allocated = bean.getThreadAllocatedBytes(thread) - allocatedBefore
        println("ArdiaBlockingRegex metered match: cpu %.2f us per match over %d matches, %.2f bytes allocated per match".format(perMatch, runs, allocated.toDouble() / runs))
        assertTrue(compileMillis < 5_000)
        assertTrue("cpu per match $perMatch us", perMatch < 100)
        assertTrue("allocated $allocated bytes", allocated.toDouble() / runs < 1)
    }
}
