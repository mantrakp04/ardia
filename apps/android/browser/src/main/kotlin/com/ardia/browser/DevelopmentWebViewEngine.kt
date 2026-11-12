package com.ardia.browser

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient

class DevelopmentWebViewEngine : PageEngine {
    override val name: String = "System WebView (development only)"
    override val isDevelopmentOnly: Boolean = true

    override fun createPage(context: Context): Page = WebViewPage(context)
}

private class WebViewPage(context: Context) : Page {
    private val listeners = LinkedHashSet<(PageState) -> Unit>()
    private val webView = WebView(context)

    override val view: View get() = webView

    override var state: PageState = PageState()
        private set

    init {
        configure()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = publish(isLoading = true, url = url)

            override fun onPageFinished(view: WebView, url: String?) = publish(isLoading = false, url = url)

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) = publish(url = url)
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) = publish(progress = newProgress / 100f)

            override fun onReceivedTitle(view: WebView, title: String?) = publish(title = title)
        }
    }

    private fun publish(isLoading: Boolean? = null, url: String? = null, progress: Float? = null, title: String? = null) {
        state = state.copy(
            url = url ?: webView.url ?: state.url,
            title = title ?: webView.title ?: state.title,
            progress = progress ?: state.progress,
            isLoading = isLoading ?: state.isLoading,
            canGoBack = webView.canGoBack(),
            canGoForward = webView.canGoForward(),
        )
        listeners.toList().forEach { it(state) }
    }

    override fun load(url: String) = webView.loadUrl(url)

    override fun reload() = webView.reload()

    override fun stop() = webView.stopLoading()

    override fun goBack(): Boolean = webView.canGoBack().also { if (it) webView.goBack() }

    override fun goForward(): Boolean = webView.canGoForward().also { if (it) webView.goForward() }

    override fun observe(listener: (PageState) -> Unit): AutoCloseable {
        listeners += listener
        listener(state)
        return AutoCloseable { listeners -= listener }
    }

    override fun close() {
        listeners.clear()
        webView.stopLoading()
        webView.destroy()
    }
}
