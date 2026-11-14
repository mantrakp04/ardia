package com.ardia.browser.android

import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.appmodel.SystemLink
import com.ardia.browser.BrowserUrl

sealed interface SystemEntry {
    data class Link(val uri: String) : SystemEntry

    data class Search(val query: String) : SystemEntry

    fun deliver(model: AppModel) {
        when (this) {
            is Link -> model.open(uri)
            is Search -> model.handle(SystemLink.Search(query))
        }
    }

    companion object {
        fun from(intent: Intent?): SystemEntry? {
            intent ?: return null
            return when (intent.action) {
                Intent.ACTION_VIEW -> intent.data?.let(::link)
                Intent.ACTION_WEB_SEARCH, Intent.ACTION_SEARCH -> words(intent.getStringExtra(SearchManager.QUERY)) ?: Link(SystemLink.Search(null).uri)
                Intent.ACTION_PROCESS_TEXT -> words(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString())
                else -> null
            }
        }

        fun words(text: String?): SystemEntry? {
            val trimmed = text?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            if (!trimmed.contains(' ') && BrowserUrl.isWeb(trimmed)) return Link(trimmed)
            return Search(trimmed)
        }

        private fun link(uri: Uri): SystemEntry? {
            val text = uri.toString()
            val scheme = uri.scheme?.lowercase() ?: return null
            return if (scheme == SystemLink.SCHEME || scheme == "http" || scheme == "https") Link(text) else null
        }
    }
}

object SystemIntents {
    fun main(context: Context, link: SystemLink): Intent = main(context, link.uri)

    fun main(context: Context, uri: String): Intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        .setClass(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun launchArguments(context: Context, intent: Intent?): LaunchArguments {
        if (!ArdiaApplication.of(context).acceptsLaunchArguments) return LaunchArguments.none
        return runCatching { LaunchArguments.fromIntent(intent) }.getOrDefault(LaunchArguments.none)
    }
}
