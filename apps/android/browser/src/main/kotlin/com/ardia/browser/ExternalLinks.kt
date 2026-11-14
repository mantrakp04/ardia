package com.ardia.browser

import java.net.URLDecoder

enum class ExternalApp {
    Phone,
    Email,
    Messages,
    Maps,
    Store,
    Other,
}

sealed interface LinkRoute {
    data object Web : LinkRoute

    data class External(val app: ExternalApp, val fallbackUrl: String? = null) : LinkRoute

    data object Blocked : LinkRoute
}

data class IntentLink(val scheme: String?, val packageName: String?, val fallbackUrl: String?)

object ExternalLinks {
    private val webSchemes = setOf("http", "https", "about", "data", "blob", "file", BrowserUrl.BROWSE_SCHEME)
    private val blockedSchemes = setOf("javascript", "vbscript")
    private val storeHosts = setOf("play.google.com", "market.android.com")
    private const val STORE_PACKAGE = "com.android.vending"

    fun route(url: String, isMainFrame: Boolean = true): LinkRoute {
        val scheme = BrowserUrl.scheme(url) ?: return LinkRoute.Blocked
        if (scheme in blockedSchemes) return if (isMainFrame) LinkRoute.Blocked else LinkRoute.Web
        if (scheme in webSchemes) {
            if (scheme == "https" && isMainFrame && BrowserUrl.rawHost(url) in storeHosts && BrowserUrl.path(url).startsWith("/store/apps")) {
                return LinkRoute.External(ExternalApp.Store)
            }
            return LinkRoute.Web
        }
        return when (scheme) {
            "tel" -> LinkRoute.External(ExternalApp.Phone)
            "mailto" -> LinkRoute.External(ExternalApp.Email)
            "sms", "smsto", "mms", "mmsto" -> LinkRoute.External(ExternalApp.Messages)
            "geo", "google.navigation" -> LinkRoute.External(ExternalApp.Maps)
            "market" -> LinkRoute.External(ExternalApp.Store)
            "intent" -> routeIntent(url, isMainFrame)
            else -> if (isMainFrame) LinkRoute.External(ExternalApp.Other) else LinkRoute.Blocked
        }
    }

    fun asksBeforeOpening(isMainFrame: Boolean, hasGesture: Boolean): Boolean = isMainFrame || hasGesture

    fun parseIntent(url: String): IntentLink? {
        if (BrowserUrl.scheme(url) != "intent") return null
        val marker = url.indexOf("#Intent;")
        if (marker < 0) return IntentLink(null, null, null)
        val fields = url.substring(marker + "#Intent;".length).split(';').takeWhile { it != "end" }
        val values = fields.mapNotNull { field ->
            val equals = field.indexOf('=')
            if (equals <= 0) null else field.substring(0, equals) to field.substring(equals + 1)
        }.toMap()
        val fallback = values["S.browser_fallback_url"]?.let { decode(it) }?.takeIf { BrowserUrl.isWeb(it) }
        return IntentLink(values["scheme"]?.lowercase(), values["package"], fallback)
    }

    private fun routeIntent(url: String, isMainFrame: Boolean): LinkRoute {
        val link = parseIntent(url) ?: return LinkRoute.Blocked
        if (!isMainFrame && link.fallbackUrl == null) return LinkRoute.Blocked
        val app = when {
            link.packageName == STORE_PACKAGE || link.scheme == "market" -> ExternalApp.Store
            link.scheme == "tel" -> ExternalApp.Phone
            link.scheme == "mailto" -> ExternalApp.Email
            link.scheme == "geo" -> ExternalApp.Maps
            else -> ExternalApp.Other
        }
        return LinkRoute.External(app, link.fallbackUrl)
    }

    private fun decode(value: String): String? = runCatching { URLDecoder.decode(value, Charsets.UTF_8.name()) }.getOrNull()
}
