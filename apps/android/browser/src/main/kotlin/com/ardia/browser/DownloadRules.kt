package com.ardia.browser

import java.io.Closeable
import java.io.InputStream
import java.net.URI

enum class DownloadFailure {
    Network,
    Server,
    InsecureRedirect,
    TooManyRedirects,
    Unsupported,
    Storage,
}

fun interface DownloadCookies {
    fun cookieHeader(url: String, isPrivate: Boolean): String?
}

class DownloadResponse(
    val status: Int,
    headers: Map<String, List<String>>,
    val body: InputStream,
    private val onClose: () -> Unit = {},
) : Closeable {
    private val lowercased = headers.mapKeys { it.key.lowercase() }

    fun header(name: String): String? = lowercased[name.lowercase()]?.firstOrNull()

    val contentLength: Long? get() = header("content-length")?.toLongOrNull()?.takeIf { it >= 0 }

    override fun close() {
        runCatching { body.close() }
        onClose()
    }
}

fun interface DownloadTransport {
    fun open(url: String, headers: Map<String, String>): DownloadResponse
}

class DownloadRefused(val failure: DownloadFailure) : Exception(failure.name)

object DownloadRules {
    const val MAX_REDIRECTS = 10
    const val FALLBACK_NAME = "Download"
    private const val MAX_NAME_LENGTH = 120
    private val redirectStatuses = setOf(301, 302, 303, 307, 308)
    private val forbiddenNameCharacters = "/\\:*?\"<>|"

    fun isRedirect(status: Int): Boolean = status in redirectStatuses

    fun nextHop(current: String, location: String?): String {
        val target = location?.trim()?.takeIf { it.isNotEmpty() } ?: throw DownloadRefused(DownloadFailure.Server)
        val resolved = runCatching { URI(current).resolve(target).toString() }.getOrNull()
            ?: throw DownloadRefused(DownloadFailure.Server)
        if (!BrowserUrl.isWeb(resolved) || BrowserUrl.rawHost(resolved) == null) throw DownloadRefused(DownloadFailure.Unsupported)
        if (BrowserUrl.isSecure(current) && !BrowserUrl.isSecure(resolved)) throw DownloadRefused(DownloadFailure.InsecureRedirect)
        return resolved.substringBefore('#')
    }

    fun referer(referer: String?, target: String): String? {
        if (referer == null || !BrowserUrl.isWeb(referer)) return null
        if (BrowserUrl.isSecure(referer) && !BrowserUrl.isSecure(target)) return null
        val clean = referer.substringBefore('#')
        if (origin(clean) == origin(target)) return clean
        return origin(clean)?.let { "$it/" }
    }

    fun headersFor(url: String, isPrivate: Boolean, userAgent: String?, referer: String?, cookies: DownloadCookies): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        userAgent?.takeIf { it.isNotBlank() }?.let { headers["User-Agent"] = it }
        referer(referer, url)?.let { headers["Referer"] = it }
        runCatching { cookies.cookieHeader(url, isPrivate) }.getOrNull()?.takeIf { it.isNotBlank() }?.let { headers["Cookie"] = it }
        return headers
    }

    fun fetch(
        url: String,
        isPrivate: Boolean,
        userAgent: String?,
        referer: String?,
        cookies: DownloadCookies,
        transport: DownloadTransport,
    ): Pair<String, DownloadResponse> {
        if (!BrowserUrl.isWeb(url)) throw DownloadRefused(DownloadFailure.Unsupported)
        var current = url.substringBefore('#')
        var hops = 0
        while (true) {
            val response = try {
                transport.open(current, headersFor(current, isPrivate, userAgent, referer, cookies))
            } catch (error: DownloadRefused) {
                throw error
            } catch (error: Exception) {
                throw DownloadRefused(DownloadFailure.Network)
            }
            if (response.status in 200..299) return current to response
            response.close()
            if (!isRedirect(response.status)) throw DownloadRefused(DownloadFailure.Server)
            hops += 1
            if (hops > MAX_REDIRECTS) throw DownloadRefused(DownloadFailure.TooManyRedirects)
            current = nextHop(current, response.header("location"))
        }
    }

    fun safeFileName(raw: String?, fallback: String = FALLBACK_NAME): String {
        val lastSegment = raw.orEmpty().substringAfterLast('/').substringAfterLast('\\')
        val cleaned = lastSegment
            .filter { it >= ' ' && it != '\u007f' && it !in forbiddenNameCharacters }
            .trim()
            .trim('.')
            .trim()
        if (cleaned.isEmpty()) return fallback
        if (cleaned.length <= MAX_NAME_LENGTH) return cleaned
        val extension = cleaned.substringAfterLast('.', "").takeIf { it.isNotEmpty() && it.length <= 10 && it.length < cleaned.length - 1 }
        return if (extension == null) {
            cleaned.take(MAX_NAME_LENGTH).trim()
        } else {
            cleaned.dropLast(extension.length + 1).take(MAX_NAME_LENGTH - extension.length - 1).trim() + "." + extension
        }
    }

    fun uniqueName(name: String, taken: Set<String>): String {
        val lowered = taken.mapTo(HashSet()) { it.lowercase() }
        if (name.lowercase() !in lowered) return name
        val dot = name.lastIndexOf('.').takeIf { it > 0 }
        val base = if (dot == null) name else name.substring(0, dot)
        val extension = if (dot == null) "" else name.substring(dot)
        var counter = 2
        while (true) {
            val candidate = "$base $counter$extension"
            if (candidate.lowercase() !in lowered) return candidate
            counter += 1
        }
    }

    private fun origin(url: String): String? {
        val scheme = BrowserUrl.scheme(url) ?: return null
        val afterScheme = url.indexOf("//").takeIf { it >= 0 }?.plus(2) ?: return null
        val end = url.indexOfAny(charArrayOf('/', '?', '#'), afterScheme).takeIf { it >= 0 } ?: url.length
        val authority = url.substring(afterScheme, end).substringAfterLast('@').lowercase()
        if (authority.isEmpty()) return null
        return "$scheme://$authority"
    }
}

data class UploadLocation(val authority: String, val pathPrefix: String)

object UploadCheck {
    private const val CONTENT_PREFIX = "content://"

    fun accepts(uri: String, ownAuthorities: Set<String>, capture: UploadLocation?): Boolean {
        if (!uri.startsWith(CONTENT_PREFIX)) return false
        val rest = uri.substring(CONTENT_PREFIX.length)
        val authorityEnd = rest.indexOfAny(charArrayOf('/', '?', '#')).takeIf { it >= 0 } ?: rest.length
        val rawAuthority = rest.substring(0, authorityEnd)
        val user = rawAuthority.substringBeforeLast('@', "")
        if (rawAuthority.contains('@') && (user.isEmpty() || !user.all(Char::isDigit))) return false
        val authority = rawAuthority.substringAfterLast('@')
        if (authority.isEmpty() || authority.contains(':')) return false
        val encodedPath = rest.substring(authorityEnd).substringBefore('?').substringBefore('#')
        val path = decode(encodedPath) ?: return false
        if (path.contains('\\') || path.contains('\u0000') || path.split('/').any { it == ".." || it == "." }) return false
        if (ownAuthorities.none { it.equals(authority, ignoreCase = true) }) return true
        if (capture == null || !capture.authority.equals(authority, ignoreCase = true)) return false
        return path.startsWith(capture.pathPrefix) && path.length > capture.pathPrefix.length
    }

    private fun decode(value: String): String? {
        val bytes = java.io.ByteArrayOutputStream()
        var index = 0
        while (index < value.length) {
            val char = value[index]
            if (char == '%') {
                if (index + 2 >= value.length) return null
                val byte = value.substring(index + 1, index + 3).toIntOrNull(16) ?: return null
                bytes.write(byte)
                index += 3
            } else {
                bytes.write(char.toString().toByteArray(Charsets.UTF_8))
                index += 1
            }
        }
        return bytes.toString(Charsets.UTF_8.name())
    }
}
