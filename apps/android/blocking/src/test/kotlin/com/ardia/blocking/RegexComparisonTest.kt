package com.ardia.blocking

import java.io.File
import java.lang.management.ManagementFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RegexComparisonTest {
    private class RegexRule(val line: String, val source: String, val matchCase: Boolean)

    private fun regexRules(): Pair<String, List<RegexRule>> {
        val directory = System.getProperty("ardia.blockingLists")?.let(::File)?.takeIf { it.isDirectory }
        val texts = if (directory != null) {
            listOf("easylist.txt", "easyprivacy.txt", "fanboy-cookiemonster.txt").map { File(directory, it).readText() }
        } else {
            listOf("easylist-sample.txt", "easyprivacy-sample.txt", "cookie-sample.txt").map(::resource) + resource("syntax-sample.txt")
        }
        val rules = ArrayList<RegexRule>()
        for (text in texts) {
            for (raw in text.lineSequence()) {
                val line = raw.trim()
                if (line.startsWith("!") || line.contains("##") || line.contains("#@#")) continue
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
        }
        return (if (directory != null) "real lists" else "samples") to rules
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
        assertTrue(matchedPairs > 0)
        assertTrue("RE2/J refused ${refusedNow.size} rules java accepted", refusedNow.size * 20 <= javaOk.size)
    }

    @Test
    fun re2CostsStaySmallAtEngineBuildAndPerMatch() {
        val (source, rules) = regexRules()
        val runtime = Runtime.getRuntime()
        System.gc()
        val before = runtime.totalMemory() - runtime.freeMemory()
        val started = System.nanoTime()
        val compiled = rules.mapNotNull { ListRegex.compile(it.source, it.matchCase) }
        val compileMillis = (System.nanoTime() - started) / 1_000_000.0
        System.gc()
        val retained = runtime.totalMemory() - runtime.freeMemory() - before
        val programs = compiled.map { it.programSize() }
        println(
            "ArdiaBlockingRegex $source: compiled ${compiled.size} rules in %.1f ms, program size total=%d max=%d, retained about %d KB"
                .format(compileMillis, programs.sum(), programs.maxOrNull() ?: 0, retained / 1024),
        )
        repeat(3) { for (pattern in compiled) for (url in corpus) pattern.matcher(url).find() }
        val matchStart = System.nanoTime()
        var runs = 0
        repeat(5) { for (pattern in compiled) for (url in corpus) { pattern.matcher(url).find(); runs++ } }
        val perMatch = (System.nanoTime() - matchStart) / runs / 1000.0
        println("ArdiaBlockingRegex per match: %.2f us over %d matches".format(perMatch, runs))
        val perRule = compiled.map { pattern ->
            val begin = System.nanoTime()
            repeat(20) { for (url in corpus) pattern.matcher(url).find() }
            (System.nanoTime() - begin) / (20.0 * corpus.size) / 1000.0 to pattern.pattern()
        }.sortedByDescending { it.first }
        perRule.take(4).forEach { (micros, pattern) -> println("ArdiaBlockingRegex slowest rule %.2f us per match: %s".format(micros, pattern.take(100))) }

        val engine = engineOf(rules.joinToString("\n") { it.line })
        val bean = ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean
        val thread = Thread.currentThread().id
        val url = "https://cdn.jsdelivr.net/npm/abcd-ef@latest/dist/script.min.js"
        repeat(2_000) { engine.blocks(url, "https://site.test/") }
        val context = RequestContext.current()
        val runsBefore = context.regexRuns
        val allocatedBefore = bean.getThreadAllocatedBytes(thread)
        repeat(10_000) { engine.blocks(url, "https://site.test/") }
        val allocated = bean.getThreadAllocatedBytes(thread) - allocatedBefore
        val regexRuns = context.regexRuns - runsBefore
        println(
            "ArdiaBlockingRegex a request that reaches regex rules: %.1f regex runs and %.0f bytes allocated per request"
                .format(regexRuns / 10_000.0, allocated / 10_000.0),
        )
        assertTrue(compileMillis < 2_000)
        assertTrue(perMatch < 50)
    }
}
