package com.ardia.appmodel

import android.net.Uri
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.browser.BrowserUrl

sealed interface SystemLink {
    data class Search(val query: String?) : SystemLink

    data object VoiceSearch : SystemLink

    data object Incognito : SystemLink

    data class Open(val url: String) : SystemLink

    data class Tab(val id: String) : SystemLink

    data object MacTabs : SystemLink

    val uri: String
        get() = when (this) {
            is Search -> if (query.isNullOrEmpty()) "$SCHEME://search" else "$SCHEME://search?q=" + Uri.encode(query)
            VoiceSearch -> "$SCHEME://voice"
            Incognito -> "$SCHEME://incognito"
            is Open -> "$SCHEME://open?url=" + Uri.encode(url)
            is Tab -> "$SCHEME://tab/$id"
            MacTabs -> "$SCHEME://mac-tabs"
        }

    companion object {
        const val SCHEME = BrowserUrl.BROWSE_SCHEME

        fun parse(uri: String): SystemLink? {
            val parsed = runCatching { Uri.parse(uri) }.getOrNull() ?: return null
            if (parsed.scheme?.lowercase() != SCHEME) return null
            return when (parsed.host?.lowercase()) {
                "search" -> Search(parsed.getQueryParameter("q")?.trim()?.ifEmpty { null })
                "voice" -> VoiceSearch
                "incognito" -> Incognito
                "mac-tabs" -> MacTabs
                "open" -> parsed.getQueryParameter("url")?.takeIf(BrowserUrl::isWeb)?.let(::Open)
                "tab" -> parsed.path?.trim('/')?.ifEmpty { null }?.let(::Tab)
                else -> null
            }
        }
    }
}

@Stable
class DefaultBrowserStatus(private val system: SystemActions, private val asksSystem: Boolean) {
    var isDefault: Boolean by mutableStateOf(false)
        private set
    var isOffered: Boolean by mutableStateOf(false)
        private set
    private var awaitingSettingsReturn = false

    fun willOpenSystemSettings() {
        awaitingSettingsReturn = true
    }

    fun receivedLinkFromSystem() {
        refresh()
    }

    fun sceneBecameActive() {
        awaitingSettingsReturn = false
        refresh()
    }

    private fun refresh() {
        if (!asksSystem) return
        val answer = system.isDefaultBrowser()
        isOffered = answer != null
        isDefault = answer == true
    }
}
