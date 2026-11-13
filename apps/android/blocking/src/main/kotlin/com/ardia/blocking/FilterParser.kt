package com.ardia.blocking


enum class RequestType(internal val bit: Int) {
    DOCUMENT(1),
    SUBDOCUMENT(2),
    SCRIPT(4),
    IMAGE(8),
    STYLESHEET(16),
    FONT(32),
    MEDIA(64),
    XHR(128),
    WEBSOCKET(256),
    PING(512),
    OTHER(1024),
    POPUP(2048),
    UNKNOWN(0),
    ;

    companion object {
        internal const val SUBRESOURCES = 2 or 4 or 8 or 16 or 32 or 64 or 128 or 256 or 512 or 1024
        internal const val EVERYTHING = SUBRESOURCES or 1 or 2048
    }
}

enum class SkipReason {
    UNSUPPORTED_OPTION,
    UNSUPPORTED_COSMETIC,
    INVALID_SELECTOR,
    INVALID_DOMAIN,
    UNSUPPORTED_PATTERN,
    TOO_BROAD,
    NEVER_APPLIES,
    UNSUPPORTED_REGEX,
    UNINDEXED_REGEX,
}

internal object Party {
    const val ANY = 0
    const val THIRD = 1
    const val FIRST = 2
}

internal object Anchor {
    const val NONE = 0
    const val START = 1
    const val HOST = 2
}

internal class NetworkFilter(
    val key: String,
    val isException: Boolean,
    val isImportant: Boolean,
    val matchCase: Boolean,
    val party: Int,
    val typeMask: Int,
    val anchor: Int,
    val anchorEnd: Boolean,
    val host: String?,
    val pattern: String,
    val isRegex: Boolean,
    val includeDomains: List<String>,
    val excludeDomains: List<String>,
) {
    val restrictsType: Boolean get() = (typeMask and RequestType.SUBRESOURCES) != RequestType.SUBRESOURCES
}

internal class CosmeticFilter(
    val selector: String,
    val isException: Boolean,
    val includeDomains: List<String>,
    val excludeDomains: List<String>,
)

class ParsedFilterList internal constructor(
    val id: String,
    val convertedLines: Int,
    val skippedLines: Int,
    internal val network: List<NetworkFilter>,
    internal val cosmetic: List<CosmeticFilter>,
    internal val badfilters: Set<String>,
    internal val documentAllows: List<String>,
    internal val elemhideAllows: List<String>,
    internal val genericHideAllows: List<String>,
    val skipped: Map<SkipReason, Int>,
    internal val ruleUnits: Int = 0,
    internal val textChars: Long = 0,
) {
    val networkRuleCount: Int get() = network.size
    val cosmeticRuleCount: Int get() = cosmetic.size

    companion object {
        fun empty(id: String) = ParsedFilterList(id, 0, 0, emptyList(), emptyList(), emptySet(), emptyList(), emptyList(), emptyList(), emptyMap())
    }
}

object FilterParser {
    private val unsupportedCosmetic = listOf("#?#", "#$#", "#%#", "#@?#", "#@$#", "#@%#", "##+js(", "#@#+js(", "##^", "#@#^", "#$?#", "#@$?#")
    private val hostsFileAddresses = setOf("0.0.0.0", "127.0.0.1", "::", "::1", "0")
    private val hostsFileIgnored = setOf("localhost", "localhost.localdomain", "local", "broadcasthost", "0.0.0.0", "ip6-localhost")
    private val skippedOptions = setOf(
        "csp", "removeparam", "queryprune", "redirect-rule", "rewrite", "replace", "header", "permissions", "urltransform", "uritransform",
        "method", "to", "denyallow", "sitekey", "genericblock", "specifichide", "shide", "cookie", "hls", "jsonprune",
        "network", "app", "stealth", "urlskip", "inline-script", "inline-font", "strict1p", "strict3p", "strict-first-party",
        "strict-third-party", "cname", "ipaddress", "popunder", "webrtc", "object-subrequest", "doc-elemhide", "content", "extension",
        "jsinject", "xmlprune",
    )
    private val allowedPseudoClasses = setOf(
        "not", "nth-child", "nth-of-type", "nth-last-child", "nth-last-of-type", "first-child", "last-child", "only-child",
        "first-of-type", "last-of-type", "only-of-type", "empty", "root", "is", "where", "has", "link", "visited", "checked",
    )
    private const val HOST_STOPS = "^/*|?:$"

    private const val MAX_LINE_LENGTH = 16_384
    private const val MAX_PATTERN_LENGTH = 2_048
    private val defaultBudget = ListBudget()

    fun parse(text: String, id: String, maxRules: Int = defaultBudget.maxRulesPerList, maxChars: Long = defaultBudget.maxCharsPerList): ParsedFilterList {
        val builder = ListBuilder(id, maxRules, maxChars)
        var start = 0
        val length = text.length
        while (start <= length) {
            var end = text.indexOf('\n', start)
            if (end < 0) end = length
            builder.line(text, start, end)
            start = end + 1
        }
        return builder.build()
    }

    fun parse(reader: java.io.BufferedReader, id: String, maxRules: Int = defaultBudget.maxRulesPerList, maxChars: Long = defaultBudget.maxCharsPerList): ParsedFilterList {
        val builder = ListBuilder(id, maxRules, maxChars)
        while (true) {
            val line = reader.readLine() ?: break
            builder.line(line, 0, line.length)
        }
        return builder.build()
    }

    private class ListBuilder(val id: String, val maxRules: Int, val maxChars: Long) {
        var converted = 0
        var skipped = 0
        var units = 0
        var chars = 0L
        var unindexedRegex = 0
        val network = ArrayList<NetworkFilter>()
        val cosmetic = ArrayList<CosmeticFilter>()
        val badfilters = HashSet<String>()
        val documentAllows = ArrayList<String>()
        val elemhideAllows = ArrayList<String>()
        val genericHideAllows = ArrayList<String>()
        val reasons = HashMap<SkipReason, Int>()
        val seenNetwork = HashSet<String>()
        val seenGeneric = HashSet<String>()

        fun skip(reason: SkipReason) {
            skipped++
            reasons[reason] = (reasons[reason] ?: 0) + 1
        }

        fun spend(textLength: Int) {
            units++
            chars += textLength
            if (units > maxRules || chars > maxChars) throw FilterListTooLargeException(id)
        }

        fun line(text: String, start: Int, end: Int) {
            if (end - start > MAX_LINE_LENGTH) {
                if (text.substring(start, minOf(end, start + 64)).trim().let { it.isNotEmpty() && !it.startsWith("!") }) skip(SkipReason.UNSUPPORTED_PATTERN)
                return
            }
            val line = text.substring(start, end).trim()
            if (line.isEmpty() || line.startsWith("!") || line.startsWith("[")) return
            if (line.startsWith("#") && !line.startsWith("##") && !line.startsWith("#@#") && !line.startsWith("#?#") && !line.startsWith("#$#")) return
            if (isIgnoredHostsLine(line)) return
            hostsFileDomain(line)?.let { host ->
                converted++
                val key = "||$host^"
                if (seenNetwork.add(key)) {
                    spend(key.length + host.length)
                    network += NetworkFilter(
                        key, false, false, false, Party.ANY, RequestType.SUBRESOURCES, Anchor.HOST, false, host, "^", false, emptyList(), emptyList(),
                    )
                }
                return
            }
            if (line.indexOf('#') >= 0) {
                val cosmeticResult = parseCosmetic(line)
                if (cosmeticResult != null) {
                    when (cosmeticResult) {
                        is CosmeticParse.Skip -> skip(cosmeticResult.reason)
                        is CosmeticParse.Rule -> {
                            converted++
                            val rule = cosmeticResult.filter
                            val isGeneric = !rule.isException && rule.includeDomains.isEmpty() && rule.excludeDomains.isEmpty()
                            if (!isGeneric || seenGeneric.add(rule.selector)) {
                                spend(rule.selector.length + rule.includeDomains.sumOf { it.length } + rule.excludeDomains.sumOf { it.length })
                                cosmetic += rule
                            }
                        }
                    }
                    return
                }
            }
            when (val result = parseNetwork(line)) {
                is NetworkParse.Skip -> skip(result.reason)
                is NetworkParse.Badfilter -> {
                    converted++
                    if (badfilters.add(result.key)) spend(result.key.length)
                }
                is NetworkParse.Rule -> {
                    val filter = result.filter
                    if (filter.key in seenNetwork) {
                        converted++
                        return
                    }
                    if (ListRegex.isUnindexed(filter) && ++unindexedRegex > ListRegex.MAX_UNINDEXED_PER_LIST) {
                        skip(SkipReason.UNINDEXED_REGEX)
                        return
                    }
                    converted++
                    if (seenNetwork.add(filter.key)) {
                        spend(filter.key.length + filter.pattern.length + (filter.host?.length ?: 0) + filter.includeDomains.sumOf { it.length } + filter.excludeDomains.sumOf { it.length })
                        network += filter
                    }
                }
                is NetworkParse.HostAllow -> {
                    converted++
                    spend(result.host.length)
                    when (result.kind) {
                        HostAllowKind.DOCUMENT -> documentAllows += result.host
                        HostAllowKind.ELEMHIDE -> elemhideAllows += result.host
                        HostAllowKind.GENERICHIDE -> genericHideAllows += result.host
                    }
                }
            }
        }

        fun build() = ParsedFilterList(
            id, converted, skipped, network, cosmetic, badfilters, documentAllows, elemhideAllows, genericHideAllows, reasons, units, chars,
        )
    }

    internal fun hostsFileDomain(line: String): String? {
        val first = line.firstOrNull() ?: return null
        if (!first.isDigit() && first != ':') return null
        val parts = line.split(' ', '\t').filter { it.isNotEmpty() }
        if (parts.size < 2 || parts[0] !in hostsFileAddresses) return null
        val host = parts[1].lowercase()
        if (host in hostsFileIgnored) return null
        return normalizeDomain(host)
    }

    private fun isIgnoredHostsLine(line: String): Boolean {
        val first = line.firstOrNull() ?: return false
        if (!first.isDigit() && first != ':') return false
        val parts = line.split(' ', '\t').filter { it.isNotEmpty() }
        return parts.size >= 2 && parts[0] in hostsFileAddresses && parts[1].lowercase() in hostsFileIgnored
    }

    internal sealed class CosmeticParse {
        class Rule(val filter: CosmeticFilter) : CosmeticParse()

        class Skip(val reason: SkipReason) : CosmeticParse()
    }

    internal fun parseCosmetic(line: String): CosmeticParse? {
        val exceptionAt = line.indexOf("#@#")
        val hideAt = if (exceptionAt >= 0) -1 else line.indexOf("##")
        val isUnsupported = unsupportedCosmetic.any { line.contains(it) }
        if (exceptionAt < 0 && hideAt < 0) return if (isUnsupported) CosmeticParse.Skip(SkipReason.UNSUPPORTED_COSMETIC) else null
        if (isUnsupported) return CosmeticParse.Skip(SkipReason.UNSUPPORTED_COSMETIC)
        val isException = exceptionAt >= 0
        val markerStart = if (isException) exceptionAt else hideAt
        val markerEnd = markerStart + if (isException) 3 else 2
        val selector = line.substring(markerEnd).trim()
        if (!isValidSelector(selector)) return CosmeticParse.Skip(SkipReason.INVALID_SELECTOR)
        val includes = ArrayList<String>()
        val excludes = ArrayList<String>()
        val prefix = line.substring(0, markerStart)
        if (prefix.isNotEmpty()) {
            for (part in prefix.split(',')) {
                val entry = part.trim()
                val negative = entry.startsWith("~")
                val domain = normalizeDomain(if (negative) entry.substring(1) else entry) ?: return CosmeticParse.Skip(SkipReason.INVALID_DOMAIN)
                if (negative) excludes += domain else includes += domain
            }
        }
        return CosmeticParse.Rule(CosmeticFilter(selector, isException, includes.distinct(), excludes.distinct()))
    }

    internal enum class HostAllowKind { DOCUMENT, ELEMHIDE, GENERICHIDE }

    internal sealed class NetworkParse {
        class Rule(val filter: NetworkFilter) : NetworkParse()

        class HostAllow(val host: String, val kind: HostAllowKind) : NetworkParse()

        class Badfilter(val key: String) : NetworkParse()

        class Skip(val reason: SkipReason) : NetworkParse()
    }

    private fun skip(reason: SkipReason) = NetworkParse.Skip(reason)

    internal fun parseNetwork(line: String): NetworkParse {
        var body = line
        val isException = body.startsWith("@@")
        if (isException) body = body.substring(2)
        var options = emptyList<String>()
        val dollar = body.lastIndexOf('$')
        if (dollar >= 0) {
            val tail = body.substring(dollar + 1)
            if (tail.isNotEmpty() && tail.all(::isOptionChar)) {
                options = tail.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }
                body = body.substring(0, dollar)
            }
        }
        val isRegexBody = body.length > 2 && body.startsWith("/") && body.endsWith("/")
        if (!isRegexBody && body.any { it == ' ' || it == '\t' || it == '$' }) return skip(SkipReason.UNSUPPORTED_PATTERN)
        if ("badfilter" in options) return NetworkParse.Badfilter(filterKey(isException, body, options.filter { it != "badfilter" }))
        val key = filterKey(isException, body, options)

        var party = Party.ANY
        var matchCase = false
        var important = false
        var included = 0
        var negated = 0
        var includeDomains = emptyList<String>()
        var excludeDomains = emptyList<String>()
        var hostAllow: HostAllowKind? = null
        var everything = false
        for (option in options) {
            val negative = option.startsWith("~")
            val name = if (negative) option.substring(1) else option
            val equals = name.indexOf('=')
            val base = if (equals >= 0) name.substring(0, equals) else name
            when (base) {
                "third-party", "3p" -> party = if (negative) Party.FIRST else Party.THIRD
                "first-party", "1p" -> party = if (negative) Party.THIRD else Party.FIRST
                "match-case" -> matchCase = true
                "important" -> important = true
                "all" -> if (negative) return skip(SkipReason.UNSUPPORTED_OPTION) else everything = true
                "redirect", "empty", "mp4" -> if (negative) return skip(SkipReason.UNSUPPORTED_OPTION)
                "document", "doc" -> if (negative) negated = negated or RequestType.DOCUMENT.bit else {
                    included = included or RequestType.DOCUMENT.bit
                    if (isException) hostAllow = HostAllowKind.DOCUMENT
                }
                "elemhide", "ehide" -> if (negative || !isException) return skip(SkipReason.UNSUPPORTED_OPTION) else hostAllow = HostAllowKind.ELEMHIDE
                "generichide", "ghide" -> if (negative || !isException) {
                    return skip(SkipReason.UNSUPPORTED_OPTION)
                } else {
                    hostAllow = HostAllowKind.GENERICHIDE
                }
                "domain", "from" -> {
                    if (negative || equals < 0) return skip(SkipReason.UNSUPPORTED_OPTION)
                    val includes = ArrayList<String>()
                    val excludes = ArrayList<String>()
                    for (entry in name.substring(equals + 1).split('|')) {
                        val off = entry.startsWith("~")
                        val domain = normalizeDomain(if (off) entry.substring(1) else entry) ?: return skip(SkipReason.INVALID_DOMAIN)
                        if (off) excludes += domain else includes += domain
                    }
                    includeDomains = includes.distinct()
                    excludeDomains = excludes.distinct()
                }
                else -> {
                    if (base in skippedOptions) return skip(SkipReason.UNSUPPORTED_OPTION)
                    val type = resourceType(base) ?: return skip(SkipReason.UNSUPPORTED_OPTION)
                    if (negative) negated = negated or type.bit else included = included or type.bit
                }
            }
        }

        if (hostAllow != null) {
            val onlyThisOption = options.size == 1
            val host = pureHost(body)
            if (!isException || !onlyThisOption || host == null) return skip(SkipReason.UNSUPPORTED_OPTION)
            return NetworkParse.HostAllow(host, hostAllow)
        }

        if (included != 0 && negated != 0) return skip(SkipReason.UNSUPPORTED_OPTION)
        val typeMask = when {
            everything -> RequestType.EVERYTHING
            negated != 0 -> RequestType.SUBRESOURCES and negated.inv()
            included != 0 -> included
            else -> RequestType.SUBRESOURCES
        }
        if (typeMask == 0) return skip(SkipReason.NEVER_APPLIES)
        if (typeMask and RequestType.POPUP.bit.inv() == 0) return skip(SkipReason.NEVER_APPLIES)

        if (isRegexBody && ListRegex.compile(body.substring(1, body.length - 1), matchCase) == null) {
            return skip(SkipReason.UNSUPPORTED_REGEX)
        }
        val shape = patternShape(body, matchCase) ?: return skip(SkipReason.UNSUPPORTED_PATTERN)
        val unrestricted = shape.anchor == Anchor.NONE && !shape.isRegex && shape.pattern.isEmpty() && !shape.anchorEnd &&
            includeDomains.isEmpty() && (typeMask and RequestType.SUBRESOURCES) == RequestType.SUBRESOURCES
        if (unrestricted && !isException) return skip(SkipReason.TOO_BROAD)
        return NetworkParse.Rule(
            NetworkFilter(
                key, isException, important && !isException, matchCase, party, typeMask, shape.anchor, shape.anchorEnd, shape.host,
                shape.pattern, shape.isRegex, includeDomains, excludeDomains,
            ),
        )
    }

    private class Shape(val anchor: Int, val anchorEnd: Boolean, val host: String?, val pattern: String, val isRegex: Boolean)

    private fun patternShape(raw: String, matchCase: Boolean): Shape? {
        if (raw.length > 2 && raw.startsWith("/") && raw.endsWith("/")) {
            return Shape(Anchor.NONE, false, null, raw.substring(1, raw.length - 1), true)
        }
        if (raw.length > MAX_PATTERN_LENGTH || raw.any { it.code >= 0x80 }) return null
        var rest = if (matchCase) raw else raw.lowercase()
        var anchor = Anchor.NONE
        var host: String? = null
        if (rest.startsWith("||")) {
            anchor = Anchor.HOST
            rest = rest.substring(2)
            var end = 0
            while (end < rest.length && HOST_STOPS.indexOf(rest[end]) < 0) end++
            val hostPart = rest.substring(0, end)
            if (hostPart.isEmpty() || !hostPart.all(::isHostChar)) return null
            val terminated = end < rest.length && rest[end] != '*'
            if (terminated) {
                host = hostPart.lowercase().trimEnd('.')
                if (host.isEmpty()) return null
                rest = rest.substring(end)
            }
        } else if (rest.startsWith("|")) {
            anchor = Anchor.START
            rest = rest.substring(1)
        } else if (rest.length < 4 && !rest.contains('*')) {
            return null
        }
        var anchorEnd = false
        if (rest.endsWith("|")) {
            rest = rest.dropLast(1)
            anchorEnd = true
        }
        if (rest.contains('|')) return null
        if (anchor == Anchor.NONE) while (rest.startsWith("*")) rest = rest.substring(1)
        if (!anchorEnd) while (rest.endsWith("*")) rest = rest.dropLast(1)
        if (host == null && anchor == Anchor.HOST && rest.isEmpty()) return null
        return Shape(anchor, anchorEnd, host, if (rest == "^") "^" else rest, false)
    }

    private fun pureHost(body: String): String? {
        if (!body.startsWith("||")) return null
        var rest = body.substring(2)
        if (rest.endsWith("^|")) rest = rest.dropLast(2) else if (rest.endsWith("^")) rest = rest.dropLast(1)
        return normalizeDomain(rest)
    }

    private fun filterKey(isException: Boolean, pattern: String, options: List<String>): String =
        (if (isException) "@@" else "") + pattern + if (options.isEmpty()) "" else "$" + options.joinToString(",")

    private fun isOptionChar(char: Char): Boolean =
        char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || ",=|~._-*".indexOf(char) >= 0

    private fun isHostChar(char: Char): Boolean = char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '.' || char == '-' || char == '_'

    internal fun resourceType(option: String): RequestType? = when (option) {
        "script" -> RequestType.SCRIPT
        "image" -> RequestType.IMAGE
        "stylesheet", "css" -> RequestType.STYLESHEET
        "font" -> RequestType.FONT
        "media" -> RequestType.MEDIA
        "popup" -> RequestType.POPUP
        "ping", "beacon" -> RequestType.PING
        "xmlhttprequest", "xhr" -> RequestType.XHR
        "websocket" -> RequestType.WEBSOCKET
        "subdocument", "frame" -> RequestType.SUBDOCUMENT
        "other", "object" -> RequestType.OTHER
        else -> null
    }

    fun normalizeDomain(raw: String): String? {
        var value = raw
        if (value.endsWith(".")) value = value.dropLast(1)
        if (value.isEmpty() || value.length > 253 || value.startsWith(".")) return null
        val out = StringBuilder(value.length)
        var hasDot = false
        var previous = ' '
        for (original in value) {
            val char = if (original in 'A'..'Z') original + 32 else original
            val valid = char in 'a'..'z' || char in '0'..'9' || char == '-' || char == '.'
            if (!valid || (char == '.' && previous == '.')) return null
            if (char == '.') hasDot = true
            out.append(char)
            previous = char
        }
        return if (hasDot) out.toString() else null
    }

    fun isValidSelector(selector: String): Boolean {
        if (selector.isEmpty() || selector.length > 2000) return false
        if (selector.any { it.code < 0x20 || it.code == 0x7F }) return false
        if (selector.contains('{') || selector.contains('}') || selector.contains('\\') || selector.startsWith(",") || selector.endsWith(",")) return false
        var depth = 0
        var bracket = 0
        var quote: Char? = null
        var index = 0
        while (index < selector.length) {
            val char = selector[index]
            val open = quote
            if (open != null) {
                if (char == open) quote = null
                index++
                continue
            }
            when (char) {
                '"', '\'' -> {
                    if (bracket <= 0) return false
                    quote = char
                }
                '[' -> bracket++
                ']' -> {
                    bracket--
                    if (bracket < 0) return false
                }
                '(' -> depth++
                ')' -> {
                    depth--
                    if (depth < 0) return false
                }
                ':' -> if (bracket == 0) {
                    var end = index + 1
                    if (end < selector.length && selector[end] == ':') return false
                    while (end < selector.length && (selector[end].isLetter() || selector[end] == '-')) end++
                    val name = selector.substring(index + 1, end).lowercase()
                    if (name !in allowedPseudoClasses) return false
                    index = end
                    continue
                }
            }
            index++
        }
        return depth == 0 && bracket == 0 && quote == null
    }
}
