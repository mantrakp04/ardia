package com.ardia.blocking

internal class RequestContext {
    var raw = CharArray(1024)
    var lower = CharArray(1024)
    var length = 0
    var hostStart = 0
    var hostEnd = 0
    val hostSuffixStarts = IntArray(MAX_LABELS)
    val hostSuffixHashes = LongArray(MAX_LABELS)
    var hostSuffixCount = 0

    private var pageBuffer = CharArray(512)
    var pageChars = pageBuffer
    var pageHostStart = 0
    var pageHostEnd = 0
    var pageKnown = false
    val pageSuffixHashes = LongArray(MAX_LABELS)
    var pageSuffixCount = 0

    var tokens = LongArray(128)
    var tokenCount = 0

    var type = RequestType.UNKNOWN
    var categoryMask = 0
    var globSteps = 0
    private var party = PARTY_UNCOMPUTED
    private val labels = IntArray(MAX_LABELS)
    var regexRuns = 0L
    var regexRulesSkipped = 0L
    val regexScratch = RegexScratch()

    fun loadRequest(url: String): Boolean {
        val count = url.length
        if (raw.size < count) {
            raw = CharArray(count + count / 2)
            lower = CharArray(raw.size)
        }
        url.toCharArray(raw, 0, 0, count)
        val source = raw
        val target = lower
        for (index in 0 until count) {
            val char = source[index]
            target[index] = if (char in 'A'..'Z') char + 32 else char
        }
        length = count
        regexScratch.steps = ListRegex.stepsFor(count)
        globSteps = GLOB_STEPS_PER_REQUEST
        party = PARTY_UNCOMPUTED
        val authority = authorityStart(target, count, requireWebScheme = true)
        if (authority < 0) return false
        if (!locateHost(target, authority, count) { start, end ->
                hostStart = start
                hostEnd = end
            }
        ) {
            return false
        }
        hostSuffixCount = suffixes(target, hostStart, hostEnd, hostSuffixHashes, hostSuffixStarts)
        tokenize()
        return true
    }

    fun loadPage(pageUrl: String?, isMainFrame: Boolean) {
        if (isMainFrame) {
            pageChars = lower
            pageHostStart = hostStart
            pageHostEnd = hostEnd
            pageKnown = true
        } else if (pageUrl == null) {
            pageKnown = false
        } else {
            val count = pageUrl.length
            if (pageBuffer.size < count) pageBuffer = CharArray(count + count / 2)
            val buffer = pageBuffer
            pageUrl.toCharArray(buffer, 0, 0, count)
            for (index in 0 until count) {
                val char = buffer[index]
                if (char in 'A'..'Z') buffer[index] = char + 32
            }
            pageChars = buffer
            val authority = authorityStart(buffer, count, requireWebScheme = false)
            pageKnown = authority >= 0 && locateHost(buffer, authority, count) { start, end ->
                pageHostStart = start
                pageHostEnd = end
            }
        }
        pageSuffixCount = if (pageKnown) suffixes(pageChars, pageHostStart, pageHostEnd, pageSuffixHashes, null) else 0
    }

    fun loadHost(host: String) {
        val count = host.length
        if (pageBuffer.size < count) pageBuffer = CharArray(count + count / 2)
        val buffer = pageBuffer
        for (index in 0 until count) {
            val char = host[index]
            buffer[index] = if (char in 'A'..'Z') char + 32 else char
        }
        pageChars = buffer
        pageHostStart = 0
        pageHostEnd = count
        while (pageHostEnd > 0 && buffer[pageHostEnd - 1] == '.') pageHostEnd--
        pageKnown = pageHostEnd > 0
        pageSuffixCount = if (pageKnown) suffixes(buffer, 0, pageHostEnd, pageSuffixHashes, null) else 0
    }

    fun thirdParty(): Int {
        if (party != PARTY_UNCOMPUTED) return party
        party = if (!pageKnown) {
            PARTY_UNKNOWN
        } else {
            val suffixes = PublicSuffixes.shared
            val requestSite = suffixes.registrableStart(lower, hostStart, hostEnd, labels)
            val pageSite = suffixes.registrableStart(pageChars, pageHostStart, pageHostEnd, labels)
            if (sameRegion(lower, requestSite, hostEnd, pageChars, pageSite, pageHostEnd)) Party.FIRST else Party.THIRD
        }
        return party
    }

    fun inferType(isMainFrame: Boolean): RequestType {
        if (isMainFrame) return RequestType.DOCUMENT
        val chars = lower
        if (chars[0] == 'w') return RequestType.WEBSOCKET
        var pathEnd = hostEnd
        while (pathEnd < length && chars[pathEnd] != '?' && chars[pathEnd] != '#') pathEnd++
        var dot = -1
        var index = pathEnd - 1
        while (index > hostEnd) {
            val char = chars[index]
            if (char == '.') {
                dot = index
                break
            }
            if (char == '/' || pathEnd - index > 6) break
            index--
        }
        if (dot < 0) return RequestType.UNKNOWN
        val hash = HostHash.of(chars, dot + 1, pathEnd)
        for (entry in extensionTypes.indices) if (extensionHashes[entry] == hash) return extensionTypes[entry]
        return RequestType.UNKNOWN
    }

    private fun tokenize() {
        stamp++
        if (stamp == Int.MAX_VALUE) {
            stamp = 1
            seenStamps.fill(0)
        }
        val chars = lower
        var count = 0
        var hash = HostHash.start()
        var inToken = false
        for (index in 0..length) {
            val raw = if (index < length) chars[index] else ' '
            val char = if (raw.code < 128) raw else foldsToAscii(raw)
            if (isTokenChar(char)) {
                hash = HostHash.step(hash, char)
                inToken = true
            } else if (inToken) {
                val token = HostHash.finish(hash)
                if (firstSighting(token, count)) {
                    if (count == tokens.size) tokens = tokens.copyOf(tokens.size * 2)
                    tokens[count++] = token
                }
                hash = HostHash.start()
                inToken = false
            }
        }
        tokenCount = count
    }

    private var seenKeys = LongArray(1024)
    private var seenStamps = IntArray(1024)
    private var stamp = 0

    private fun firstSighting(token: Long, uniqueSoFar: Int): Boolean {
        if ((uniqueSoFar + 1) * 2 > seenKeys.size) {
            seenKeys = LongArray(seenKeys.size * 2)
            seenStamps = IntArray(seenKeys.size)
            stamp = 1
            for (index in 0 until uniqueSoFar) insertSeen(tokens[index])
        }
        return insertSeen(token)
    }

    private fun insertSeen(token: Long): Boolean {
        val mask = seenKeys.size - 1
        var slot = (token xor (token ushr 29)).toInt() and mask
        while (seenStamps[slot] == stamp) {
            if (seenKeys[slot] == token) return false
            slot = (slot + 1) and mask
        }
        seenStamps[slot] = stamp
        seenKeys[slot] = token
        return true
    }

    private fun suffixes(chars: CharArray, start: Int, end: Int, hashes: LongArray, starts: IntArray?): Int {
        var count = 0
        var from = start
        while (from < end && count < MAX_LABELS) {
            hashes[count] = HostHash.of(chars, from, end)
            starts?.set(count, from)
            count++
            var next = from
            while (next < end && chars[next] != '.') next++
            from = next + 1
        }
        return count
    }

    private inline fun locateHost(chars: CharArray, authority: Int, count: Int, found: (Int, Int) -> Unit): Boolean {
        var authorityEnd = authority
        while (authorityEnd < count) {
            val char = chars[authorityEnd]
            if (char == '/' || char == '?' || char == '#' || char == '\\') break
            authorityEnd++
        }
        var start = authority
        for (index in authority until authorityEnd) if (chars[index] == '@') start = index + 1
        var end: Int
        if (start < authorityEnd && chars[start] == '[') {
            end = start
            while (end < authorityEnd && chars[end] != ']') end++
            if (end < authorityEnd) end++
        } else {
            end = start
            while (end < authorityEnd && chars[end] != ':') end++
        }
        while (end > start && chars[end - 1] == '.') end--
        if (end <= start) return false
        found(start, end)
        return true
    }

    private fun authorityStart(chars: CharArray, count: Int, requireWebScheme: Boolean): Int {
        var colon = -1
        val limit = minOf(count, 12)
        for (index in 0 until limit) {
            if (chars[index] == ':') {
                colon = index
                break
            }
        }
        if (colon <= 0 || colon + 2 >= count || chars[colon + 1] != '/' || chars[colon + 2] != '/') return -1
        if (requireWebScheme && !isWebScheme(chars, colon)) return -1
        return colon + 3
    }

    private fun isWebScheme(chars: CharArray, colon: Int): Boolean = when (colon) {
        2 -> chars[0] == 'w' && chars[1] == 's'
        3 -> chars[0] == 'w' && chars[1] == 's' && chars[2] == 's'
        4 -> chars[0] == 'h' && chars[1] == 't' && chars[2] == 't' && chars[3] == 'p'
        5 -> chars[0] == 'h' && chars[1] == 't' && chars[2] == 't' && chars[3] == 'p' && chars[4] == 's'
        else -> false
    }

    private fun sameRegion(first: CharArray, firstStart: Int, firstEnd: Int, second: CharArray, secondStart: Int, secondEnd: Int): Boolean {
        if (firstEnd - firstStart != secondEnd - secondStart) return false
        for (offset in 0 until firstEnd - firstStart) if (first[firstStart + offset] != second[secondStart + offset]) return false
        return true
    }

    companion object {
        const val MAX_LABELS = 64
        const val GLOB_STEPS_PER_REQUEST = 2_000_000
        const val PARTY_UNKNOWN = -1
        private const val PARTY_UNCOMPUTED = -2

        private val extensionTable = listOf(
            "js" to RequestType.SCRIPT, "mjs" to RequestType.SCRIPT, "css" to RequestType.STYLESHEET,
            "png" to RequestType.IMAGE, "jpg" to RequestType.IMAGE, "jpeg" to RequestType.IMAGE, "gif" to RequestType.IMAGE,
            "webp" to RequestType.IMAGE, "svg" to RequestType.IMAGE, "ico" to RequestType.IMAGE, "avif" to RequestType.IMAGE,
            "bmp" to RequestType.IMAGE, "apng" to RequestType.IMAGE,
            "woff" to RequestType.FONT, "woff2" to RequestType.FONT, "ttf" to RequestType.FONT, "otf" to RequestType.FONT,
            "eot" to RequestType.FONT,
            "mp4" to RequestType.MEDIA, "webm" to RequestType.MEDIA, "mp3" to RequestType.MEDIA, "m4a" to RequestType.MEDIA,
            "ogg" to RequestType.MEDIA, "oga" to RequestType.MEDIA, "ogv" to RequestType.MEDIA, "wav" to RequestType.MEDIA,
            "m3u8" to RequestType.MEDIA, "mpd" to RequestType.MEDIA, "m4s" to RequestType.MEDIA,
        )
        private val extensionHashes = LongArray(extensionTable.size) { HostHash.of(extensionTable[it].first) }
        private val extensionTypes = Array(extensionTable.size) { extensionTable[it].second }

        private val local = ThreadLocal.withInitial { RequestContext() }

        fun current(): RequestContext = local.get()!!

        fun isTokenChar(char: Char): Boolean = char in 'a'..'z' || char in '0'..'9' || char == '%'

        private val asciiFolds: Map<Char, Char> = buildMap {
            for (letter in 'a'..'z') {
                for (rune in com.google.re2j.ArdiaProgramBridge.foldOrbit(letter.code)) if (rune in 128..0xFFFF) put(rune.toChar(), letter)
            }
        }
        private val foldedFrom = asciiFolds.keys.toCharArray()
        private val foldedTo = CharArray(foldedFrom.size) { asciiFolds.getValue(foldedFrom[it]) }

        fun foldsToAscii(char: Char): Char {
            for (index in foldedFrom.indices) if (foldedFrom[index] == char) return foldedTo[index]
            return char
        }

        internal val asciiFoldSources: Map<Char, Char> get() = asciiFolds
    }
}
