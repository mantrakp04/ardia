package com.ardia.appmodel

import com.ardia.browser.PageSetup
import com.ardia.store.BrowserUrl
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

internal object DemoSnapshotWarmer {
    const val LOAD_TIMEOUT_MILLIS = 10_000L
    const val START_MILLIS = 500L
    const val SETTLE_MILLIS = 700L
    const val BATCH_SIZE = 3

    suspend fun warm(app: AppModel) {
        if (!app.isDemo) return
        val loaded = app.awaitReady()
        val pending = loaded.tabs.openTabs.filter { it.snapshotFileName == null && BrowserUrl.isSyncable(it.url) && app.pages[it.id] == null }
        for (batch in pending.chunked(BATCH_SIZE)) {
            coroutineScope { batch.map { tab -> async { capture(app, tab.id, tab.url, tab.title) } }.awaitAll() }
        }
    }

    private suspend fun capture(app: AppModel, id: String, url: String, title: String) {
        val engine = app.web
        val page = engine.open(id, PageSetup(url = url, title = title))
        try {
            withTimeoutOrNull(LOAD_TIMEOUT_MILLIS) {
                delay(START_MILLIS)
                page.state.first { !it.isLoading }
            }
            delay(SETTLE_MILLIS)
            val image = page.snapshot() ?: return
            app.persistSnapshot(image, id)
            val state = page.state.value
            val themeHex = state.themeColor?.let(com.ardia.browser.PageColors::hex)
            app.tabStore?.update(id, title = state.title.ifBlank { null }, themeColorHex = themeHex)
        } finally {
            if (app.pages[id] == null) engine.close(id)
        }
    }
}
