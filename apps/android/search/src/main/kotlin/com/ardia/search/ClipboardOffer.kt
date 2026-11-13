package com.ardia.search

import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.view.textclassifier.TextClassifier

enum class ClipboardOffer { Link, Text }

object ClipboardOffers {
    const val LINK_CONFIDENCE = 0.5f

    fun peek(context: Context): ClipboardOffer? {
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return null
        val description = runCatching { clipboard.primaryClipDescription }.getOrNull() ?: return null
        return classify(description)
    }

    fun classify(description: ClipDescription): ClipboardOffer? {
        if (description.hasMimeType(ClipDescription.MIMETYPE_TEXT_URILIST)) return ClipboardOffer.Link
        if (!description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) && !description.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML)) return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && description.classificationStatus == ClipDescription.CLASSIFICATION_COMPLETE) {
            val linkScore = runCatching { description.getConfidenceScore(TextClassifier.TYPE_URL) }.getOrDefault(0f)
            return if (linkScore >= LINK_CONFIDENCE) ClipboardOffer.Link else ClipboardOffer.Text
        }
        return ClipboardOffer.Text
    }

    fun read(context: Context): String? {
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return null
        val clip = runCatching { clipboard.primaryClip }.getOrNull() ?: return null
        if (clip.itemCount == 0) return null
        return clip.getItemAt(0).coerceToText(context)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
    }
}
