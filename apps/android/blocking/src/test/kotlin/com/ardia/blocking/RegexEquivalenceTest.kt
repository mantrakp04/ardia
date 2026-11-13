package com.ardia.blocking

import java.util.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RegexEquivalenceTest {
    private class Rule(val line: String, val source: String, val matchCase: Boolean)

    private fun defaultListRules(): Pair<List<Rule>, List<String>> {
        val honoured = ArrayList<Rule>()
        val refused = ArrayList<String>()
        lostPatterns.clear()
        for (raw in resource("default-list-regex-rules.txt").lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            when (val result = FilterParser.parseNetwork(line)) {
                is FilterParser.NetworkParse.Rule -> if (result.filter.isRegex) honoured += Rule(line, result.filter.pattern, result.filter.matchCase)
                is FilterParser.NetworkParse.Skip -> {
                    if (result.reason == SkipReason.UNSUPPORTED_REGEX) refused += line
                    if (result.reason == SkipReason.UNSUPPORTED_PATTERN) lostPatterns += line
                }
                else -> Unit
            }
        }
        return honoured to refused
    }

    private fun folded(url: String, random: Random): String {
        val folds = RequestContext.asciiFoldSources.entries.groupBy({ it.value }, { it.key })
        return buildString {
            for (char in url) {
                val options = folds[char.lowercaseChar()]
                if (options != null && random.nextBoolean()) append(options[random.nextInt(options.size)]) else append(char)
            }
        }
    }

    private val lostPatterns = ArrayList<String>()

    private fun needsBacktracking(line: String): Boolean {
        val body = line.removePrefix("@@")
        return listOf("(?=", "(?!", "(?<=", "(?<!").any { body.contains(it) } ||
            Regex("""\\[1-9]""").containsMatchIn(body) ||
            Regex("""\{(\d+)(,(\d*))?}""").findAll(body).any { match -> match.groupValues.drop(1).mapNotNull { it.trim(',').toIntOrNull() }.any { it > 1000 } }
    }

    @Test
    fun everyDefaultListRegexRuleRunsAndOnlyBacktrackingFeaturesAreRefused() {
        val (honoured, refused) = defaultListRules()
        println("ArdiaBlockingRegex default lists: ${honoured.size} regex rules honoured, ${refused.size} refused")
        refused.forEach { println("ArdiaBlockingRegex refused (needs lookaround, backreference or a repeat over 1000): ${it.take(150)}") }
        assertEquals(emptyList<String>(), refused.filterNot { needsBacktracking(it) || it.contains("\$xhr,script,domain=dogdrip.net,replace=") })
        assertEquals(emptyList<String>(), lostPatterns.toList())
        val sizes = honoured.map { MeteredRegex(ListRegex.compile(it.source, it.matchCase)!!).size }.sorted()
        println(
            "ArdiaBlockingRegex default lists program size: median=%d p90=%d p99=%d max=%d, cap=%d"
                .format(sizes[sizes.size / 2], sizes[sizes.size * 9 / 10], sizes[sizes.size * 99 / 100], sizes.last(), ListRegex.MAX_PROGRAM_SIZE),
        )
        assertTrue(sizes.last() * 2 <= ListRegex.MAX_PROGRAM_SIZE)
    }

    private val escapeAndFoldRules = listOf(
        Rule("/\\x61bc/\$match-case", "\\x61bc", true),
        Rule("/\\x{6b}i\\x73s/", "\\x{6b}i\\x73s", false),
        Rule("/kiss/", "kiss", false),
        Rule("/\\.kiss\\./", "\\.kiss\\.", false),
        Rule("/KISS/\$match-case", "KISS", true),
        Rule("/(?i)KISS/\$match-case", "(?i)KISS", true),
        Rule("/[k]i[s]s\\.js/", "[k]i[s]s\\.js", false),
        Rule("/^https?:\\/\\/[a-z]+\\.sk\\/ask\\//", "^https?:\\/\\/[a-z]+\\.sk\\/ask\\/", false),
        Rule("/\\x2eassets\\x2f/", "\\x2eassets\\x2f", false),
        Rule("/a\\.b\\-c\\/d/", "a\\.b\\-c\\/d", false),
        Rule("/\\x41BC\\d+/", "\\x41BC\\d+", false),
        Rule("/\\\\x61/", "\\\\x61", false),
        Rule("/stats\\.js\\?k=\\d{2,4}\$/", "stats\\.js\\?k=\\d{2,4}\$", false),
    ) + listOf(
        "[[:alpha:]]ads\\.", "[[:^digit:]]ads\\.", "[[:alnum:]_]ads\\.", "\\wads\\.", "\\pLads\\.", ".ads\\.", "[^.]ads\\.",
        "(?:x)?ads\\.", "x?ads\\.", "x*ads\\.", "(?:ab|)ads\\.", "(?:\\/|q)ads\\.", "(?i)[[:upper:]]ADS\\.", "\\x{17f}ads\\.", "\u017fads\\.",
        "\\/ads[[:alpha:]]", "\\/ads\\w", "\\/ads.", "\\/ads(?:x)?", "\\/ads[^/]", "\\/ads\\b", "\\/a[[:digit:]]s\\/", "[[:alpha:]][[:alpha:]]ads\\.js",
    ).map { Rule("/$it/", it, false) }

    @Test
    fun theEngineAgreesWithAFullUrlMatchOnGeneratedUrlsForEveryRealRule() {
        val honoured = defaultListRules().first + escapeAndFoldRules
        val random = Random(20261113)
        var checked = 0
        var matched = 0
        var longChecked = 0
        var rulesWithAMatch = 0
        val mismatches = ArrayList<String>()
        val context = RequestContext.current()
        val skippedBefore = context.regexRulesSkipped
        val probe = RequestContext()
        var notRequests = 0
        for (rule in honoured) {
            val reference = ListRegex.compile(rule.source, rule.matchCase)!!
            val engine = engineOf("/${rule.source}/" + if (rule.matchCase) "\$match-case" else "")
            val samples = RegexSamples(rule.source, random).urls().flatMap { listOf(it, folded(it, random)) }.distinct()
            var ruleMatched = false
            for (url in samples) {
                if (!probe.loadRequest(url)) {
                    notRequests++
                    continue
                }
                val expected = reference.matcher(url).find()
                val actual = engine.blocks(url, "https://page.test/")
                checked++
                if (url.length > 512) longChecked++
                if (expected) {
                    matched++
                    ruleMatched = true
                }
                val agrees = if (url.length <= ListRegex.MAX_INPUT_LENGTH) expected == actual else !actual || expected
                if (!agrees) mismatches += "expected $expected for ${rule.line.take(90)} on ${url.take(120)} (${url.length} chars)"
            }
            if (ruleMatched) rulesWithAMatch++
        }
        val skipped = context.regexRulesSkipped - skippedBefore
        println(
            "ArdiaBlockingRegex equivalence: ${honoured.size} rules, $checked urls ($longChecked longer than 512 chars), $matched match, " +
                "$rulesWithAMatch rules matched at least once, $notRequests samples were not web requests, ${mismatches.size} mismatches, $skipped budget skips",
        )
        mismatches.take(20).forEach { println("ArdiaBlockingRegex mismatch: $it") }
        assertEquals(emptyList<String>(), mismatches)
        assertEquals(0L, skipped)
        assertTrue("only $rulesWithAMatch of ${honoured.size} rules matched a generated url", rulesWithAMatch * 10 >= honoured.size * 9)
    }

    @Test
    fun allRealRegexRulesTogetherStayWellInsideTheBudgetOnLongUrls() {
        val (honoured, _) = defaultListRules()
        val engine = engineOf(honoured.filter { !it.line.startsWith("@@") }.joinToString("\n") { "/${it.source}/" + if (it.matchCase) "\$match-case" else "" })
        val random = Random(7)
        val fillers = listOf("a", "A", "7", "/", "-", "%2F", "x.js", "?q=1&r=2", ".", "_")
        val context = RequestContext.current()
        var worst = 0
        var worstShare = 0.0
        var worstUrl = ""
        val skippedBefore = context.regexRulesSkipped
        for (length in listOf(100, 600, 2_100, 5_000, 12_000, 30_000)) {
            repeat(40) {
                val url = StringBuilder(if (random.nextBoolean()) "https://" else "http://")
                url.append("abcdefgh".repeat(1 + random.nextInt(2))).append(listOf(".club/", ".com/", ".info/", ".xyz/")[random.nextInt(4)])
                while (url.length < length) url.append(fillers[random.nextInt(fillers.size)])
                engine.blocks(url.toString(), "https://page.test/")
                val budget = ListRegex.stepsFor(url.length)
                val used = budget - context.regexScratch.steps
                if (used * 1.0 / budget > worstShare) {
                    worstShare = used * 1.0 / budget
                    worst = used
                    worstUrl = "${url.length} chars, budget $budget"
                }
            }
        }
        val skipped = context.regexRulesSkipped - skippedBefore
        println(
            "ArdiaBlockingRegex all ${engine.stats.blockRules} real regex rules in one engine: worst request used $worst steps, %.0f%% of its budget ($worstUrl), $skipped budget skips".format(worstShare * 100),
        )
        assertEquals(0L, skipped)
        assertTrue("worst share $worstShare", worstShare < 0.6)
    }
}

internal class RegexSamples(source: String, private val random: Random) {
    private sealed class Node {
        class Choice(val chars: CharArray) : Node()

        class Sequence(val parts: List<Node>) : Node()

        class Alternation(val branches: List<Node>) : Node()

        class Repeat(val node: Node, val min: Int, val max: Int) : Node()

        data object Nothing : Node()
    }

    private val text = source
    private var index = 0
    private val root: Node? = runCatching { alternation().also { if (index != text.length) error("trailing") } }.getOrNull()
    private var stretch = 0

    fun urls(): List<String> {
        val tree = root ?: return emptyList()
        val matching = ArrayList<String>()
        repeat(8) {
            stretch = 0
            matching += generate(tree)
        }
        for (target in listOf(600, 2_100, 5_000)) {
            stretch = target
            matching += generate(tree)
        }
        val out = ArrayList<String>()
        for (sample in matching) {
            out += asUrl(sample)
            out += asUrl(mutate(sample))
            out += asUrl(sample + "ab")
            out += asUrl(sample.dropLast(1))
        }
        for (sample in matching.take(2)) {
            out += asUrl(sample + "?pad=" + "x".repeat(600))
            out += asUrl(sample + "?pad=" + "y".repeat(2_100))
        }
        return out.distinct()
    }

    private fun asUrl(sample: String): String =
        if (sample.startsWith("http://", ignoreCase = true) || sample.startsWith("https://", ignoreCase = true)) sample else "https://example.test/$sample"

    private fun mutate(sample: String): String {
        if (sample.isEmpty()) return "Z"
        val position = random.nextInt(sample.length)
        val replacement = "Z_~@!9q".random(random.asKotlinRandom())
        return sample.substring(0, position) + replacement + sample.substring(position + 1)
    }

    private fun generate(node: Node): String = buildString { emit(node, this) }

    private fun emit(node: Node, out: StringBuilder) {
        when (node) {
            is Node.Choice -> if (node.chars.isNotEmpty()) out.append(node.chars[random.nextInt(node.chars.size)])
            is Node.Sequence -> node.parts.forEach { emit(it, out) }
            is Node.Alternation -> emit(node.branches[random.nextInt(node.branches.size)], out)
            is Node.Repeat -> {
                val count = when {
                    node.max == Int.MAX_VALUE && stretch > 0 -> node.min + stretch.also { stretch = 0 }
                    node.max == Int.MAX_VALUE -> node.min + random.nextInt(3)
                    else -> node.min + random.nextInt(minOf(node.max - node.min, 3) + 1)
                }
                repeat(count) { emit(node.node, out) }
            }
            Node.Nothing -> Unit
        }
    }

    private fun alternation(): Node {
        val branches = mutableListOf(sequence())
        while (index < text.length && text[index] == '|') {
            index++
            branches += sequence()
        }
        return if (branches.size == 1) branches[0] else Node.Alternation(branches)
    }

    private fun sequence(): Node {
        val parts = ArrayList<Node>()
        while (index < text.length && text[index] != '|' && text[index] != ')') parts += quantified(atom())
        return Node.Sequence(parts)
    }

    private fun quantified(atom: Node): Node {
        if (index >= text.length) return atom
        val repeat = when (text[index]) {
            '*' -> Node.Repeat(atom, 0, Int.MAX_VALUE).also { index++ }
            '+' -> Node.Repeat(atom, 1, Int.MAX_VALUE).also { index++ }
            '?' -> Node.Repeat(atom, 0, 1).also { index++ }
            '{' -> {
                val close = text.indexOf('}', index)
                val parts = text.substring(index + 1, close).split(',')
                index = close + 1
                val min = parts[0].trim().toInt()
                val max = if (parts.size == 1) min else parts[1].trim().toIntOrNull() ?: Int.MAX_VALUE
                Node.Repeat(atom, min, max)
            }
            else -> return atom
        }
        if (index < text.length && (text[index] == '?' || text[index] == '+')) index++
        return quantified(repeat)
    }

    private fun atom(): Node {
        val char = text[index]
        when (char) {
            '(' -> {
                index++
                if (text.startsWith("?:", index)) {
                    index += 2
                } else if (text.startsWith("?P<", index) || text.startsWith("?<", index)) {
                    index = text.indexOf('>', index) + 1
                } else if (text.startsWith("?", index)) {
                    val close = text.indexOf(')', index)
                    val colon = text.indexOf(':', index)
                    if (colon in 0 until close) {
                        index = colon + 1
                    } else {
                        index = close + 1
                        return Node.Nothing
                    }
                }
                val inner = alternation()
                index++
                return inner
            }
            '[' -> {
                val start = index
                index = ListRegex.classEnd(text, index) + 1
                return Node.Choice(members(text.substring(start, index)))
            }
            '.' -> {
                index++
                return Node.Choice("abcxyz0129".toCharArray())
            }
            '^', '$' -> {
                index++
                return Node.Nothing
            }
            '\\' -> {
                val next = text[index + 1]
                index += 2
                return when (next) {
                    'd', 'w', 's', 'D', 'W', 'S' -> Node.Choice(members("\\$next"))
                    'b', 'B', 'z', 'A' -> Node.Nothing
                    'x' -> {
                        if (text[index] == '{') {
                            val close = text.indexOf('}', index)
                            val code = text.substring(index + 1, close).toInt(16)
                            index = close + 1
                            Node.Choice(charArrayOf(code.toChar()))
                        } else {
                            val code = text.substring(index, index + 2).toInt(16)
                            index += 2
                            Node.Choice(charArrayOf(code.toChar()))
                        }
                    }
                    else -> Node.Choice(charArrayOf(next))
                }
            }
            else -> {
                index++
                return Node.Choice(charArrayOf(char))
            }
        }
    }

    private fun members(classText: String): CharArray {
        val pattern = com.google.re2j.Pattern.compile(classText)
        return (0x21..0x7e).map { it.toChar() }.filter { pattern.matcher(it.toString()).matches() }.toCharArray()
    }
}

private fun Random.asKotlinRandom(): kotlin.random.Random = kotlin.random.Random(nextLong())
