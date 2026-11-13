package com.ardia.browser

object BrowserUrl {
    const val BROWSE_SCHEME = "ardia"

    fun scheme(url: String): String? {
        val end = url.indexOf(':')
        if (end <= 0) return null
        val scheme = url.substring(0, end)
        if (!scheme[0].isLetter() || scheme.any { !it.isLetterOrDigit() && it != '+' && it != '-' && it != '.' }) return null
        return scheme.lowercase()
    }

    fun rawHost(url: String): String? {
        val scheme = scheme(url) ?: return null
        var start = scheme.length + 1
        if (!url.startsWith("//", start)) return null
        start += 2
        var end = start
        while (end < url.length && url[end] != '/' && url[end] != '?' && url[end] != '#' && url[end] != '\\') end++
        var authority = url.substring(start, end)
        val at = authority.lastIndexOf('@')
        if (at >= 0) authority = authority.substring(at + 1)
        val host = if (authority.startsWith("[")) {
            authority.substring(0, (authority.indexOf(']').takeIf { it > 0 } ?: (authority.length - 1)) + 1)
        } else {
            authority.substringBefore(':')
        }
        return host.lowercase().trimEnd('.').ifEmpty { null }
    }

    fun host(url: String): String? = rawHost(url)?.removePrefix("www.")?.ifEmpty { null }

    fun path(url: String): String {
        rawHost(url) ?: return ""
        val hostEnd = url.indexOfAny(charArrayOf('/', '?', '#'), url.indexOf("//") + 2)
        if (hostEnd < 0 || url[hostEnd] != '/') return "/"
        val end = url.indexOfAny(charArrayOf('?', '#'), hostEnd).takeIf { it >= 0 } ?: url.length
        return url.substring(hostEnd, end)
    }

    fun withoutFragment(url: String): String = url.substringBefore('#')

    fun isSecure(url: String?): Boolean = url != null && scheme(url) == "https"

    fun isWeb(url: String?): Boolean = url != null && scheme(url).let { it == "http" || it == "https" }
}
