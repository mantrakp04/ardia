package com.ardia.store

import java.net.URI

object RecentSearches {
    val hosts = listOf(
        "google.com", "bing.com", "duckduckgo.com", "ecosia.org", "brave.com", "kagi.com", "startpage.com", "yahoo.com", "perplexity.ai", "baidu.com",
        "yandex.com", "chatgpt.com",
    )
    val queryKeys = listOf("q", "query", "p", "text", "wd", "search_query")

    fun query(url: String): String? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (hosts.none { host == it || host.endsWith(".$it") }) return null
        val items = uri.rawQuery?.split('&')?.map { part ->
            val name = part.substringBefore('=')
            val value = if (part.contains('=')) part.substringAfter('=') else null
            percentDecode(name) to value?.let(::percentDecode)
        }.orEmpty()
        for (key in queryKeys) {
            val raw = items.firstOrNull { it.first == key }?.second ?: continue
            val value = raw.replace('+', ' ').trim()
            if (value.isNotEmpty()) return value
        }
        return null
    }

    fun queries(newestFirst: List<String>, limit: Int): List<String> {
        val seen = HashSet<String>()
        val result = ArrayList<String>()
        for (url in newestFirst) {
            if (result.size >= limit) break
            val query = query(url) ?: continue
            if (seen.add(query.lowercase())) result.add(query)
        }
        return result
    }

    private fun percentDecode(text: String): String {
        if (!text.contains('%')) return text
        val bytes = java.io.ByteArrayOutputStream()
        var index = 0
        while (index < text.length) {
            val char = text[index]
            if (char == '%' && index + 2 < text.length) {
                val code = text.substring(index + 1, index + 3).toIntOrNull(16)
                if (code != null) {
                    bytes.write(code)
                    index += 3
                    continue
                }
            }
            bytes.write(char.toString().toByteArray(Charsets.UTF_8))
            index++
        }
        return bytes.toString(Charsets.UTF_8.name())
    }
}
