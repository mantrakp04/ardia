package com.ardia.store

import kotlinx.serialization.Serializable

@Serializable
data class CustomSearchEngine(val id: String, val name: String, val keyword: String, val url: String)

data class SearchChoice(val engineId: String, val customUrl: String? = null, val customEngines: List<CustomSearchEngine> = emptyList())

data class EngineChoice(val id: String, val name: String)

object SearchTemplates {
    val known: Map<String, String> = mapOf(
        "google" to "https://www.google.com/search?q=%s",
        "bing" to "https://www.bing.com/search?q=%s",
        "duckduckgo" to "https://duckduckgo.com/?q=%s",
        "perplexity" to "https://www.perplexity.ai/search?q=%s",
        "chatgpt" to "https://chatgpt.com/?q=%s",
        "ecosia" to "https://www.ecosia.org/search?q=%s",
        "brave" to "https://search.brave.com/search?q=%s",
        "kagi" to "https://kagi.com/search?q=%s",
        "startpage" to "https://www.startpage.com/do/search?q=%s",
        "yahoo" to "https://search.yahoo.com/search?p=%s",
        "baidu" to "https://www.baidu.com/s?wd=%s",
        "yandex" to "https://yandex.com/search/?text=%s",
    )

    val fallbackEngines: List<EngineChoice> = listOf(
        EngineChoice("google", "Google"),
        EngineChoice("bing", "Bing"),
        EngineChoice("duckduckgo", "DuckDuckGo"),
        EngineChoice("ecosia", "Ecosia"),
        EngineChoice("brave", "Brave Search"),
        EngineChoice("kagi", "Kagi"),
        EngineChoice("startpage", "Startpage"),
        EngineChoice("yahoo", "Yahoo"),
    )

    fun template(synced: SearchChoice?, localEngineId: String): String {
        if (synced != null) {
            synced.customEngines.firstOrNull { it.id == synced.engineId }?.takeIf { it.url.contains("%s") }?.let { return it.url }
            if (synced.engineId == "custom" && synced.customUrl?.contains("%s") == true) return synced.customUrl
            known[synced.engineId]?.let { return it }
        }
        return known[localEngineId] ?: known.getValue("google")
    }

    fun name(synced: SearchChoice, engines: List<EngineChoice> = fallbackEngines): String {
        synced.customEngines.firstOrNull { it.id == synced.engineId }?.let { return it.name }
        if (synced.engineId == "custom") return "Custom"
        return name(synced.engineId, engines)
    }

    fun name(id: String, engines: List<EngineChoice> = fallbackEngines): String =
        engines.firstOrNull { it.id == id }?.name ?: fallbackEngines.firstOrNull { it.id == id }?.name ?: id.replaceFirstChar { it.uppercase() }
}
