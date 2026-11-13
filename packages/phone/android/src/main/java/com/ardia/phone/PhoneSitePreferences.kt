package com.ardia.phone

import android.content.SharedPreferences
import com.ardia.browser.BrowserUrl
import com.ardia.browser.NightShadeMode
import com.ardia.browser.SitePreferences
import org.json.JSONObject

class PhoneSitePreferences(private val store: SharedPreferences) : SitePreferences {
    private val lock = Any()
    private val privateNightShade = HashMap<String, NightShadeMode?>()
    private val privateZoom = HashMap<String, Double?>()

    var defaultNightShade: NightShadeMode
        get() = mode(store.getString(KEY_NIGHT_SHADE, null)) ?: NightShadeMode.Disabled
        set(value) {
            store.edit().putString(KEY_NIGHT_SHADE, value.raw).apply()
        }

    override fun nightShade(host: String?, isPrivate: Boolean): NightShadeMode {
        val key = host?.let(::siteKey) ?: return defaultNightShade
        if (isPrivate) synchronized(lock) { if (privateNightShade.containsKey(key)) return privateNightShade[key] ?: defaultNightShade }
        return mode(sites(KEY_NIGHT_SHADE_SITES).optString(key, "")) ?: defaultNightShade
    }

    fun siteNightShade(host: String, isPrivate: Boolean): NightShadeMode? {
        val key = siteKey(host)
        if (isPrivate) synchronized(lock) { if (privateNightShade.containsKey(key)) return privateNightShade[key] }
        return mode(sites(KEY_NIGHT_SHADE_SITES).optString(key, ""))
    }

    fun setSiteNightShade(host: String, isPrivate: Boolean, mode: NightShadeMode?) {
        val key = siteKey(host)
        if (key.isEmpty()) return
        if (isPrivate) {
            synchronized(lock) { privateNightShade[key] = mode }
            return
        }
        editSites(KEY_NIGHT_SHADE_SITES) { if (mode == null) it.remove(key) else it.put(key, mode.raw) }
    }

    override fun pageZoom(host: String?, isPrivate: Boolean): Double? {
        val key = host?.let(::siteKey) ?: return null
        if (isPrivate) synchronized(lock) { if (privateZoom.containsKey(key)) return privateZoom[key] }
        val sites = sites(KEY_ZOOM_SITES)
        return if (sites.has(key)) sites.optDouble(key) else null
    }

    override fun setPageZoom(host: String, isPrivate: Boolean, zoom: Double?) {
        val key = siteKey(host)
        if (key.isEmpty()) return
        val value = zoom?.takeIf { it != 1.0 }
        if (isPrivate) {
            synchronized(lock) { privateZoom[key] = value }
            return
        }
        editSites(KEY_ZOOM_SITES) { if (value == null) it.remove(key) else it.put(key, value) }
    }

    override fun opensLinksInApps(host: String?, isPrivate: Boolean): Boolean {
        val key = host?.let(::siteKey) ?: return false
        return sites(KEY_APP_LINK_SITES).optBoolean(key, false)
    }

    fun setOpensLinksInApps(host: String, opens: Boolean) {
        val key = siteKey(host)
        if (key.isEmpty()) return
        editSites(KEY_APP_LINK_SITES) { if (opens) it.put(key, true) else it.remove(key) }
    }

    fun endPrivateBrowsing() = synchronized(lock) {
        privateNightShade.clear()
        privateZoom.clear()
    }

    private fun sites(key: String): JSONObject = runCatching { JSONObject(store.getString(key, null) ?: "{}") }.getOrElse { JSONObject() }

    private fun editSites(key: String, change: (JSONObject) -> Unit) = synchronized(lock) {
        val sites = sites(key)
        change(sites)
        store.edit().putString(key, sites.toString()).apply()
    }

    companion object {
        private const val KEY_NIGHT_SHADE = "nightShade.default"
        private const val KEY_NIGHT_SHADE_SITES = "nightShade.sites"
        private const val KEY_ZOOM_SITES = "pageZoom.sites"
        private const val KEY_APP_LINK_SITES = "appLinks.sites"

        fun mode(raw: String?): NightShadeMode? = NightShadeMode.entries.firstOrNull { it.raw == raw }

        fun siteKey(host: String): String {
            val lower = (BrowserUrl.host(host) ?: host).lowercase().trim('.', ' ')
            return if (lower.startsWith("www.")) lower.substring(4) else lower
        }
    }
}
