package com.ardia.phone

import android.app.SearchManager
import android.content.Intent
import android.net.Uri
import com.ardia.appmodel.SystemLink
import com.ardia.browser.BrowserUrl

object PhoneSystemLinks {
    const val SOURCE_EXTRA = "com.ardia.SOURCE"
    private const val HANDLED_EXTRA = "com.ardia.phone.LINK_HANDLED"
    private const val INBOX_HOST = "inbox"
    private const val QUEUE_LIMIT = 20

    private val sharedLink = Regex("(?i)\\bhttps?://[^\\s<>\"]+")
    private const val TRAILING = ".,;:!?)]}'\""

    fun interface Listener {
        fun link(payload: Map<String, Any?>)
    }

    private val lock = Any()
    private val queued = ArrayDeque<Map<String, Any?>>()
    private var listener: Listener? = null

    fun link(intent: Intent?): Map<String, Any?>? {
        intent ?: return null
        return when (intent.action) {
            Intent.ACTION_VIEW -> intent.data?.let { view(it, intent.getStringExtra(SOURCE_EXTRA)) }
            Intent.ACTION_WEB_SEARCH, Intent.ACTION_SEARCH -> words(intent.getStringExtra(SearchManager.QUERY), "intent") ?: payload(SystemLink.Search(null), "intent")
            Intent.ACTION_PROCESS_TEXT -> words(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString(), "intent")
            Intent.ACTION_SEND -> shared(intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString())
            else -> null
        }
    }

    fun receive(intent: Intent?, restored: Boolean = false) {
        intent ?: return
        if (restored || intent.getBooleanExtra(HANDLED_EXTRA, false)) return
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        val payload = link(intent) ?: return
        intent.putExtra(HANDLED_EXTRA, true)
        deliver(payload)
    }

    fun takeInitial(): Map<String, Any?>? = synchronized(lock) { queued.removeFirstOrNull() }

    fun listen(listener: Listener): Listener {
        val waiting = synchronized(lock) {
            this.listener = listener
            ArrayList(queued).also { queued.clear() }
        }
        waiting.forEach { runCatching { listener.link(it) } }
        return listener
    }

    fun stopListening(listener: Listener) = synchronized(lock) {
        if (this.listener === listener) this.listener = null
    }

    internal fun forgetForTests() = synchronized(lock) {
        queued.clear()
        listener = null
    }

    private fun deliver(payload: Map<String, Any?>) {
        val current = synchronized(lock) {
            listener ?: run {
                if (queued.size >= QUEUE_LIMIT) queued.removeFirst()
                queued.addLast(payload)
                null
            }
        }
        current?.let { runCatching { it.link(payload) } }
    }

    private fun view(uri: Uri, declaredSource: String?): Map<String, Any?>? {
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme == "http" || scheme == "https") return mapOf("kind" to "open", "url" to uri.toString(), "source" to "web")
        if (scheme != SystemLink.SCHEME) return null
        val source = if (declaredSource == "shortcut") "shortcut" else "system"
        if (uri.host?.lowercase() == INBOX_HOST) return mapOf("kind" to "inbox", "source" to source)
        return SystemLink.parse(uri.toString())?.let { payload(it, source) }
    }

    private fun words(text: String?, source: String): Map<String, Any?>? {
        val trimmed = text?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (!trimmed.contains(' ') && BrowserUrl.isWeb(trimmed)) return mapOf("kind" to "open", "url" to trimmed, "source" to source)
        return payload(SystemLink.Search(trimmed), source)
    }

    private fun shared(text: String?): Map<String, Any?>? {
        val clean = text?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val link = sharedLink.find(clean)?.value?.trimEnd { it in TRAILING }?.takeIf { it.substringAfter("://").isNotEmpty() }
        if (link != null) return mapOf("kind" to "open", "url" to link, "source" to "share")
        return words(clean, "share")
    }

    fun payload(link: SystemLink, source: String): Map<String, Any?> = when (link) {
        is SystemLink.Search -> if (link.query == null) mapOf("kind" to "search", "source" to source) else mapOf("kind" to "search", "query" to link.query, "source" to source)
        SystemLink.VoiceSearch -> mapOf("kind" to "voiceSearch", "source" to source)
        SystemLink.Incognito -> mapOf("kind" to "incognito", "source" to source)
        is SystemLink.Open -> mapOf("kind" to "open", "url" to link.url, "source" to source)
        is SystemLink.Tab -> mapOf("kind" to "tab", "id" to link.id, "source" to source)
        SystemLink.MacTabs -> mapOf("kind" to "macTabs", "source" to source)
    }
}
