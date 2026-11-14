package com.ardia.blocking

import java.util.Locale
import kotlinx.serialization.Serializable

enum class FilterListGroup(val title: String) {
    BUILT_IN("Built-in uBlock Filters"),
    ADS("Ads"),
    PRIVACY("Privacy"),
    MALWARE("Malware Protection"),
    MULTIPURPOSE("Multipurpose"),
    ANNOYANCES("Cookie Notices and Annoyances"),
    REGIONS("Regions"),
    CUSTOM("Your Lists"),
    ;

    companion object {
        fun fromCatalogGroup(group: String): FilterListGroup = when (group) {
            "default" -> BUILT_IN
            "ads" -> ADS
            "privacy" -> PRIVACY
            "malware" -> MALWARE
            "multipurpose" -> MULTIPURPOSE
            "annoyances", "cookies" -> ANNOYANCES
            "regions" -> REGIONS
            else -> CUSTOM
        }
    }
}

@Serializable
data class FilterListCatalog(val ubo: String, val lists: List<Entry>) {
    @Serializable
    data class Entry(
        val id: String,
        val title: String,
        val group: String,
        val group2: String? = null,
        val parent: String? = null,
        val off: Boolean = false,
        val lang: List<String>? = null,
        val ua: String? = null,
        val tags: List<String>? = null,
        val updateAfter: Int = 5,
        val urls: List<String> = emptyList(),
        val supportURL: String? = null,
        val instructionURL: String? = null,
    ) {
        val category: BlockingCategory
            get() = when {
                group2 == "cookies" -> BlockingCategory.COOKIE_BANNERS
                group == "privacy" || id == "ublock-privacy" -> BlockingCategory.TRACKERS
                else -> BlockingCategory.ADS
            }
    }

    fun defaultSelection(languages: List<String>, isMobile: Boolean): Set<String> {
        val codes = languages.mapNotNull { languageCode(it) }.toSet()
        val selection = lists.filter { !it.off }.map { it.id }.toMutableSet()
        selection += ALWAYS_ON
        for (entry in lists) {
            val lang = entry.lang
            if (lang != null && lang.any { it in codes }) selection += entry.id
            if (isMobile && entry.ua == "mobile") selection += entry.id
        }
        return selection
    }

    companion object {
        val ALWAYS_ON: Set<String> = setOf("fanboy-cookiemonster")

        val bundled: FilterListCatalog by lazy {
            val stream = FilterListCatalog::class.java.getResourceAsStream("/com/ardia/blocking/FilterListCatalog.json")
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
            text?.let { runCatching { blockingJson.decodeFromString(serializer(), it) }.getOrNull() } ?: FilterListCatalog("", emptyList())
        }

        private fun languageCode(tag: String): String? {
            val code = Locale.forLanguageTag(tag.replace('_', '-')).language.lowercase()
            if (code.isEmpty()) return null
            return when (code) {
                "iw" -> "he"
                "in" -> "id"
                "ji" -> "yi"
                else -> code
            }
        }
    }
}
