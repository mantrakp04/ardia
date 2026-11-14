package com.ardia.browser

import android.graphics.Bitmap
import android.view.View

enum class PageSecurity {
    None,
    Secure,
    Mixed,
    Insecure,
    ;

    companion object {
        fun of(url: String?, sawInsecureContent: Boolean): PageSecurity = when (url?.let(BrowserUrl::scheme)) {
            "https" -> if (sawInsecureContent) Mixed else Secure
            "http" -> Insecure
            else -> None
        }
    }
}

data class PageState(
    val url: String? = null,
    val title: String = "",
    val progress: Float = 0f,
    val isLoading: Boolean = false,
    val canGoBack: Boolean = false,
    val canGoForward: Boolean = false,
    val faviconUrl: String? = null,
    val favicon: Bitmap? = null,
    val themeColor: Int? = null,
    val backgroundColor: Int? = null,
    val security: PageSecurity = PageSecurity.None,
    val failure: PageLoadFailure? = null,
    val pageZoom: Double = 1.0,
    val isDesktopSite: Boolean = false,
    val scrollDirection: ScrollDirection = ScrollDirection.Up,
    val isScrolledToTop: Boolean = true,
    val blockedRequests: Int = 0,
    val isLive: Boolean = false,
) {
    val host: String? get() = url?.let(BrowserUrl::host)
}

data class FindResult(val query: String, val activeIndex: Int, val total: Int, val isDone: Boolean) {
    val hasMatches: Boolean get() = total > 0
}

class FullscreenVideo internal constructor(val view: View, private val onExit: () -> Unit) {
    fun exit() = onExit()
}

enum class NightShadeMode(val raw: String) {
    Disabled("disabled"),
    Automatic("automatic"),
    Always("always"),
}

class PrivatePagesUnavailableException : IllegalStateException("Private pages need separate website data, which this WebView cannot give")

enum class WebsiteDataKind {
    Cache,
    CookiesAndSiteData,
}

object PageZoom {
    val levels: List<Double> = listOf(0.5, 0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0)

    fun clamp(zoom: Double): Double = zoom.coerceIn(levels.first(), levels.last())

    fun next(current: Double): Double? = levels.firstOrNull { it > current + 0.001 }

    fun previous(current: Double): Double? = levels.lastOrNull { it < current - 0.001 }
}
