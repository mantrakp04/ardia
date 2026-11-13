package com.ardia.blocking


internal class NetworkRule(
    val isException: Boolean,
    val matchCase: Boolean,
    val party: Int,
    val typeMask: Int,
    val restrictsType: Boolean,
    val categoryBit: Int,
    val anchor: Int,
    val anchorEnd: Boolean,
    val host: CharArray?,
    val pattern: CharArray,
    val regex: MeteredRegex?,
    val include: LongArray?,
    val exclude: LongArray?,
) {
    private val regexNeedsWholeUrl = regex != null && ListRegex.dependsOnInputEnd(String(pattern))
    private val isHostOnly = host != null && !anchorEnd && pattern.size == 1 && pattern[0] == '^'

    fun applies(context: RequestContext): Boolean {
        if (categoryBit and context.categoryMask == 0) return false
        val type = context.type
        if (type == RequestType.UNKNOWN) {
            if (restrictsType && !isException) return false
        } else if (typeMask and type.bit == 0) {
            return false
        }
        if (party != Party.ANY) {
            val actual = context.thirdParty()
            if (actual == RequestContext.PARTY_UNKNOWN) {
                if (!isException) return false
            } else if (actual != party) {
                return false
            }
        }
        if (include != null || exclude != null) {
            if (!context.pageKnown) {
                if (include != null) return false
            } else if (!DomainMatch.applies(context.pageSuffixHashes, context.pageSuffixCount, include, exclude)) {
                return false
            }
        }
        return true
    }

    fun matchesAfterHost(context: RequestContext, hostEnd: Int): Boolean {
        if (isHostOnly) return true
        val chars = if (matchCase) context.raw else context.lower
        return Glob.matches(pattern, chars, hostEnd, context.length, anchoredStart = true, anchoredEnd = anchorEnd, context = context)
    }

    fun matchesUrl(context: RequestContext): Boolean {
        regex?.let { compiled ->
            val shown = minOf(context.length, ListRegex.MAX_INPUT_LENGTH)
            if (regexNeedsWholeUrl && context.length > shown) return false
            val scratch = context.regexScratch
            if (scratch.steps < ListRegex.STEPS_PER_RULE_CHECK) {
                context.regexRulesSkipped++
                ListRegex.countBudgetSkip()
                return false
            }
            scratch.steps -= ListRegex.STEPS_PER_RULE_CHECK
            context.regexRuns++
            return when (compiled.find(context.raw, shown, scratch)) {
                MeteredRegex.MATCH -> true
                MeteredRegex.NO_MATCH -> false
                else -> {
                    context.regexRulesSkipped++
                    ListRegex.countBudgetSkip()
                    false
                }
            }
        }
        val chars = if (matchCase) context.raw else context.lower
        return when (anchor) {
            Anchor.START -> Glob.matches(pattern, chars, 0, context.length, anchoredStart = true, anchoredEnd = anchorEnd, context = context)
            Anchor.HOST -> {
                val lower = context.lower
                var position = context.hostStart
                val end = context.hostEnd
                while (position < end) {
                    if (position == context.hostStart || lower[position - 1] == '.') {
                        if (Glob.matches(pattern, chars, position, context.length, anchoredStart = true, anchoredEnd = anchorEnd, context = context)) return true
                    }
                    position++
                }
                false
            }
            else -> Glob.matches(pattern, chars, 0, context.length, anchoredStart = false, anchoredEnd = anchorEnd, context = context)
        }
    }

    fun hostEquals(context: RequestContext, start: Int): Boolean {
        val expected = host ?: return false
        val end = context.hostEnd
        if (end - start != expected.size) return false
        val chars = context.lower
        for (offset in expected.indices) if (chars[start + offset] != expected[offset]) return false
        return true
    }

    companion object {
        fun from(filter: NetworkFilter, categoryBit: Int, regex: MeteredRegex?): NetworkRule = NetworkRule(
            isException = filter.isException,
            matchCase = filter.matchCase,
            party = filter.party,
            typeMask = filter.typeMask,
            restrictsType = filter.restrictsType,
            categoryBit = if (filter.isException) ALL_CATEGORIES else categoryBit,
            anchor = filter.anchor,
            anchorEnd = filter.anchorEnd,
            host = filter.host?.toCharArray(),
            pattern = filter.pattern.toCharArray(),
            regex = regex,
            include = DomainMatch.hashes(filter.includeDomains),
            exclude = DomainMatch.hashes(filter.excludeDomains),
        )

        const val ALL_CATEGORIES = -1
    }
}

internal object DomainMatch {
    fun hashes(domains: List<String>): LongArray? {
        if (domains.isEmpty()) return null
        val hashes = LongArray(domains.size) { HostHash.of(domains[it]) }
        hashes.sort()
        return hashes
    }

    fun applies(suffixes: LongArray, count: Int, include: LongArray?, exclude: LongArray?): Boolean {
        for (index in 0 until count) {
            val hash = suffixes[index]
            if (exclude != null && exclude.binarySearch(hash) >= 0) return false
            if (include != null && include.binarySearch(hash) >= 0) return true
        }
        return include == null
    }
}

internal object Glob {
    fun matches(pattern: CharArray, text: CharArray, from: Int, to: Int, anchoredStart: Boolean, anchoredEnd: Boolean, context: RequestContext): Boolean {
        val budget = context.globSteps
        val patternEnd = pattern.size
        var p = 0
        var s = from
        var starP = if (anchoredStart) -1 else 0
        var starS = from
        var steps = budget
        var result = false
        while (true) {
            if (--steps < 0) break
            if (p == patternEnd) {
                if (!anchoredEnd || s == to) {
                    result = true
                    break
                }
            } else {
                val char = pattern[p]
                if (char == '*') {
                    p++
                    starP = p
                    starS = s
                    continue
                }
                if (s < to) {
                    val matched = if (char == '^') isSeparator(text[s]) else char == text[s]
                    if (matched) {
                        p++
                        s++
                        continue
                    }
                } else if (char == '^') {
                    p++
                    continue
                }
            }
            if (starP < 0) break
            starS++
            if (starS > to) break
            s = starS
            p = starP
        }
        context.globSteps = maxOf(steps, 0)
        return result
    }

    fun isSeparator(char: Char): Boolean =
        !(char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '_' || char == '-' || char == '.' || char == '%')
}

internal class RuleIndex private constructor(
    private val rules: Array<NetworkRule>,
    private val byHost: LongBuckets,
    private val byToken: LongBuckets,
    private val byPageDomain: LongBuckets,
    private val unindexed: IntArray,
) {
    val size: Int get() = rules.size
    val unindexedCount: Int get() = unindexed.size

    fun matches(context: RequestContext): Boolean {
        if (rules.isEmpty()) return false
        if (!byHost.isEmpty) {
            for (index in 0 until context.hostSuffixCount) {
                val slot = byHost.slot(context.hostSuffixHashes[index])
                if (slot < 0) continue
                val start = context.hostSuffixStarts[index]
                for (cursor in byHost.start(slot) until byHost.end(slot)) {
                    val rule = rules[byHost.ids[cursor]]
                    if (rule.hostEquals(context, start) && rule.applies(context) && rule.matchesAfterHost(context, context.hostEnd)) return true
                }
            }
        }
        if (!byToken.isEmpty) {
            val tokens = context.tokens
            for (index in 0 until context.tokenCount) {
                val slot = byToken.slot(tokens[index])
                if (slot < 0) continue
                for (cursor in byToken.start(slot) until byToken.end(slot)) {
                    val rule = rules[byToken.ids[cursor]]
                    if (rule.applies(context) && rule.matchesUrl(context)) return true
                }
            }
        }
        if (!byPageDomain.isEmpty && context.pageKnown) {
            for (index in 0 until context.pageSuffixCount) {
                val slot = byPageDomain.slot(context.pageSuffixHashes[index])
                if (slot < 0) continue
                for (cursor in byPageDomain.start(slot) until byPageDomain.end(slot)) {
                    val rule = rules[byPageDomain.ids[cursor]]
                    if (rule.applies(context) && rule.matchesUrl(context)) return true
                }
            }
        }
        for (id in unindexed) {
            val rule = rules[id]
            if (rule.applies(context) && rule.matchesUrl(context)) return true
        }
        return false
    }

    class Builder {
        private val filters = ArrayList<NetworkFilter>()
        private val categories = ArrayList<Int>()
        private val regexes = ArrayList<MeteredRegex?>()

        fun add(filter: NetworkFilter, categoryBit: Int) {
            val regex = if (filter.isRegex) ListRegex.compile(filter.pattern, filter.matchCase)?.let(::MeteredRegex) ?: return else null
            filters += filter
            categories += categoryBit
            regexes += regex
        }

        fun build(): RuleIndex {
            val candidates = arrayOfNulls<List<String>>(filters.size)
            val frequency = HashMap<String, Int>()
            for (index in filters.indices) {
                val filter = filters[index]
                if (filter.host != null) continue
                val tokens = if (filter.isRegex) Tokens.regexCandidates(filter.pattern) else Tokens.candidates(filter)
                candidates[index] = tokens
                for (token in tokens) frequency[token] = (frequency[token] ?: 0) + 1
            }
            val rules = Array(filters.size) { NetworkRule.from(filters[it], categories[it], regexes[it]) }
            val byHost = LongBuckets.Builder()
            val byToken = LongBuckets.Builder()
            val byPageDomain = LongBuckets.Builder()
            val unindexed = ArrayList<Int>()
            for (index in filters.indices) {
                val filter = filters[index]
                val host = filter.host
                if (host != null) {
                    byHost.add(HostHash.of(host), index)
                    continue
                }
                val best = candidates[index]?.minWithOrNull(
                    compareBy<String>({ if (it in Tokens.common) 1 else 0 }, { frequency[it] ?: 0 }, { -it.length }),
                )
                when {
                    best != null -> byToken.add(HostHash.of(best), index)
                    filter.includeDomains.isNotEmpty() ->
                        filter.includeDomains.forEach { byPageDomain.add(HostHash.of(it), index) }
                    else -> unindexed += index
                }
            }
            return RuleIndex(rules, byHost.build(), byToken.build(), byPageDomain.build(), unindexed.toIntArray())
        }
    }
}

internal object Tokens {
    val common = setOf(
        "http", "https", "www", "com", "net", "org", "js", "css", "html", "php", "cdn", "static", "assets", "images", "img", "api",
        "jpg", "png", "gif", "ad", "ads",
    )

    fun candidates(filter: NetworkFilter): List<String> {
        val pattern = filter.pattern
        val result = ArrayList<String>(4)
        var index = 0
        while (index < pattern.length) {
            if (!isPatternTokenChar(pattern[index])) {
                index++
                continue
            }
            val start = index
            while (index < pattern.length && isPatternTokenChar(pattern[index])) index++
            val end = index
            val leftBounded = if (start == 0) filter.anchor != Anchor.NONE else pattern[start - 1] != '*'
            val rightBounded = if (end == pattern.length) filter.anchorEnd else pattern[end] != '*'
            if (leftBounded && rightBounded) result += pattern.substring(start, end).lowercase()
        }
        return result
    }

    private const val LITERAL = 0
    private const val ANY = 1
    private const val START = 2
    private const val END = 3

    private class Atom(val kind: Int, val char: Char = ' ', var quantified: Boolean = false)

    fun regexCandidates(source: String): List<String> {
        val atoms = ArrayList<Atom>()
        if (!readAtoms(source, 0, source.length, atoms)) return emptyList()
        val result = ArrayList<String>(4)
        var index = 0
        while (index < atoms.size) {
            if (!isTokenLiteral(atoms[index])) {
                index++
                continue
            }
            val start = index
            var clean = true
            while (index < atoms.size && isTokenLiteral(atoms[index])) {
                if (atoms[index].quantified) clean = false
                index++
            }
            val left = atoms.getOrNull(start - 1)
            val right = atoms.getOrNull(index)
            val leftBounded = left != null && !left.quantified && (left.kind == START || breaksToken(left))
            val rightBounded = right != null && !right.quantified && (right.kind == END || breaksToken(right))
            if (clean && leftBounded && rightBounded) {
                result += buildString { for (atom in start until index) append(atoms[atom].char.lowercaseChar()) }
            }
        }
        return result
    }

    private fun breaksToken(atom: Atom) = atom.kind == LITERAL && atom.char.code < 128 && !isPatternTokenChar(atom.char)

    private fun isTokenLiteral(atom: Atom) = atom.kind == LITERAL && isPatternTokenChar(atom.char)

    private fun readAtoms(source: String, from: Int, to: Int, atoms: MutableList<Atom>): Boolean {
        var index = from
        while (index < to) {
            val char = source[index]
            when (char) {
                '|' -> return false
                '\\' -> {
                    if (index + 1 >= to) return false
                    val next = source[index + 1]
                    atoms += if (next.isLetterOrDigit()) Atom(ANY) else Atom(LITERAL, next)
                    index += 2
                    continue
                }
                '[' -> {
                    val end = ListRegex.classEnd(source, index, to)
                    if (end < 0) return false
                    atoms += Atom(ANY)
                    index = end + 1
                    continue
                }
                '(' -> {
                    val close = closingParen(source, index, to)
                    if (close < 0) return false
                    val quantified = close + 1 < to && source[close + 1] in "?*+{"
                    val lookaround = source.startsWith("(?=", index) || source.startsWith("(?!", index) || source.startsWith("(?<", index)
                    val bodyStart = if (source.startsWith("(?:", index)) index + 3 else index + 1
                    val inner = ArrayList<Atom>()
                    if (quantified || lookaround || !readAtoms(source, bodyStart, close, inner)) atoms += Atom(ANY) else atoms += inner
                    index = close + 1
                    continue
                }
                '.' -> atoms += Atom(ANY)
                '^' -> atoms += Atom(START)
                '$' -> atoms += Atom(END)
                '?', '*', '+' -> {
                    val previous = atoms.lastOrNull() ?: return false
                    previous.quantified = true
                }
                '{' -> {
                    val previous = atoms.lastOrNull() ?: return false
                    previous.quantified = true
                    val end = source.indexOf('}', index)
                    if (end < 0 || end >= to) return false
                    index = end + 1
                    continue
                }
                else -> atoms += Atom(LITERAL, char)
            }
            index++
        }
        return true
    }

    private fun closingParen(source: String, open: Int, to: Int): Int {
        var depth = 0
        var index = open
        while (index < to) {
            val char = source[index]
            when {
                char == '\\' -> index++
                char == '[' -> {
                    val end = ListRegex.classEnd(source, index, to)
                    if (end < 0) return -1
                    index = end
                }
                char == '(' -> depth++
                char == ')' -> {
                    depth--
                    if (depth == 0) return index
                }
            }
            index++
        }
        return -1
    }

    private fun isPatternTokenChar(char: Char): Boolean =
        char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '%'
}
