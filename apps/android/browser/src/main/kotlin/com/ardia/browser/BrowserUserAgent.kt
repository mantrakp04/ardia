package com.ardia.browser

object BrowserUserAgent {
    private const val FALLBACK_CHROME_MAJOR = "140"
    private val chromeVersion = Regex("Chrome/(\\d+)")

    fun chromeMajor(systemUserAgent: String): String = chromeVersion.find(systemUserAgent)?.groupValues?.get(1) ?: FALLBACK_CHROME_MAJOR

    fun mobile(systemUserAgent: String): String =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor(systemUserAgent)}.0.0.0 Mobile Safari/537.36"

    fun desktop(systemUserAgent: String): String =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor(systemUserAgent)}.0.0.0 Safari/537.36"
}
