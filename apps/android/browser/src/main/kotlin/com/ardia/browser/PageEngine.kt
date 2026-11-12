package com.ardia.browser

import android.content.Context
import android.view.View

data class PageState(
    val url: String? = null,
    val title: String? = null,
    val progress: Float = 0f,
    val isLoading: Boolean = false,
    val canGoBack: Boolean = false,
    val canGoForward: Boolean = false,
)

interface Page : AutoCloseable {
    val view: View
    val state: PageState

    fun load(url: String)

    fun reload()

    fun stop()

    fun goBack(): Boolean

    fun goForward(): Boolean

    fun observe(listener: (PageState) -> Unit): AutoCloseable
}

interface PageEngine {
    val name: String
    val isDevelopmentOnly: Boolean

    fun createPage(context: Context): Page
}
