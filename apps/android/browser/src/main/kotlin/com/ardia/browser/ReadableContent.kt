package com.ardia.browser

import org.json.JSONObject

class ReadableContentException(val reason: Reason) : Exception(reason.name) {
    enum class Reason {
        PageNotLoaded,
        NotReadable,
    }
}

data class ReadableContent(
    val url: String,
    val title: String,
    val siteName: String,
    val byline: String?,
    val excerpt: String?,
    val leadImage: String?,
    val language: String?,
    val paragraphs: List<String>,
    val html: String,
    val wordCount: Int,
    val isArticle: Boolean,
) {
    val text: String get() = paragraphs.joinToString("\n\n")

    companion object {
        fun fromJson(json: String): ReadableContent {
            val value = JSONObject(json)
            fun optional(key: String): String? = if (value.isNull(key)) null else value.optString(key).ifEmpty { null }
            val paragraphs = value.getJSONArray("paragraphs").let { array -> List(array.length()) { array.getString(it) } }
            return ReadableContent(
                url = value.getString("url"),
                title = value.getString("title"),
                siteName = value.getString("siteName"),
                byline = optional("byline"),
                excerpt = optional("excerpt"),
                leadImage = optional("leadImage"),
                language = optional("language"),
                paragraphs = paragraphs,
                html = value.getString("html"),
                wordCount = value.getInt("wordCount"),
                isArticle = value.getBoolean("isArticle"),
            )
        }
    }
}
