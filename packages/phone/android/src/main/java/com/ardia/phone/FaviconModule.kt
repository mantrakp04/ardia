package com.ardia.phone

import com.ardia.browser.BrowserUrl
import com.ardia.design.FaviconPixels
import com.ardia.design.FaviconTone
import com.ardia.design.HttpFaviconFetcher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class FaviconModule : Module() {
    private val fetcher = HttpFaviconFetcher()

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneFavicons")

        AsyncFunction("look") Coroutine { url: String, dark: Boolean ->
            val tone = tone(url) ?: return@Coroutine null
            FaviconPayloads.look(tone, dark)
        }
    }

    private suspend fun tone(url: String): FaviconTone? {
        if (!BrowserUrl.isWeb(url)) return null
        synchronized(known) { known[url] }?.let { return it }
        val tone = withContext(Dispatchers.IO) {
            val bytes = fetcher.fetch(url) ?: return@withContext null
            val bitmap = FaviconPixels.decode(bytes, PREPARED_SIDE) ?: return@withContext null
            FaviconTone.measure(bitmap).also { bitmap.recycle() }
        } ?: return null
        synchronized(known) { known[url] = tone }
        return tone
    }

    private companion object {
        const val PREPARED_SIDE = 96
        const val REMEMBERED = 300

        val known = object : LinkedHashMap<String, FaviconTone>(64, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, FaviconTone>?): Boolean = size > REMEMBERED
        }
    }
}
