package com.ardia.appmodel

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import com.ardia.design.ArdiaSymbols
import com.ardia.design.Toast
import com.ardia.design.Toasts
import com.ardia.store.IncomingTab
import com.ardia.store.TabDestination
import com.ardia.store.TabOrigin
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal object DemoScenario {
    fun apply(app: AppModel) {
        val launch = app.launch
        if (launch.browseIncognito) app.isIncognito = true
        launch.browseOpen?.let { app.openPage(it, TabOrigin.TYPED) }
        launch.browseQuery?.let { app.browse.presentSearch(BrowseSession.SearchOrigin.Home, text = it) }
        if (launch.browseSurface == "browsing") {
            val open = app.tabs.openTabs
            val chosen = launch.browseTab?.let(open::getOrNull)?.id ?: app.tabs.selectedTabId
            chosen?.let(app::openTab)
        }
        app.scope.launch {
            delay(launch.browseDelayMillis)
            if (launch.browseToolbar) app.browse.isToolbarPresented = true
            launch.browseOverlay?.let { app.browse.presentSearch(BrowseSession.SearchOrigin.Page, text = it, selectsAll = false) }
            if (launch.browseReader) app.tabs.selectedTabId?.let { app.browse.readerTabId = it }
            if (launch.browseDeck) {
                app.browse.deckRequested = true
                launch.browseDeckOpen?.let { index ->
                    delay(DECK_OPEN_DELAY_MILLIS)
                    app.tabs.openTabs.getOrNull(index)?.let { app.openTab(it.id) }
                }
            }
            if (launch.browsePlus) {
                delay(launch.browseDelayMillis)
                app.newTab()
            }
            for (step in launch.browseSteps) {
                app.browse.stepRequest = BrowseSession.StepRequest(step)
                delay((launch.browseStepGapSeconds * 1000).toLong())
            }
        }
        launch.deckScript?.let { script ->
            app.warmDemoSnapshots()
            app.scope.launch { DeckDemoScript.run(app, script) }
        }
    }

    const val DECK_OPEN_DELAY_MILLIS = 3_000L
}

internal object LaunchHooks {
    val trustedSitesSample = listOf("nytimes.com", "theverge.com", "bbc.co.uk")

    fun run(app: AppModel) {
        val launch = app.launch
        if (launch.trustedSitesSample) trustedSitesSample.forEach { app.blocking.setExempt(it, true) }
        if (launch.opensSettings || launch.openSheet != null || launch.toast != null) {
            app.scope.launch {
                delay(SHEET_DELAY_MILLIS)
                if (launch.opensSettings) app.sheet = AppModel.Sheet.Settings
                when (launch.openSheet) {
                    "archive" -> app.openArchive()
                    "spaces" -> app.openSyncedSpaces()
                    "settings" -> app.sheet = AppModel.Sheet.Settings
                }
                launch.toast?.let { name ->
                    delay(TOAST_DELAY_MILLIS - SHEET_DELAY_MILLIS)
                    sampleToast(name)?.let(app.toasts::show)
                }
            }
        }
    }

    fun sampleToast(name: String): Toast? = when (name) {
        "copied" -> Toasts.copiedUrl()
        "cleared" -> Toasts.clearedBrowsingData()
        "received" -> Toasts.tabReceived("MacBook Pro")
        "receivedSeveral" -> Toasts.tabReceived("MacBook Pro", count = 3)
        "sent" -> Toasts.sentTab("MacBook Pro")
        "pinned" -> Toast(AppModel.PINNED, ArdiaSymbols.starFill)
        else -> null
    }

    const val SHEET_DELAY_MILLIS = 600L
    const val TOAST_DELAY_MILLIS = 1_500L
}

internal object DeckDemoScript {
    const val START_DELAY_MILLIS = 1_200L
    const val SNAP_WAIT_MILLIS = 5_000L

    suspend fun run(app: AppModel, script: String) {
        delay(START_DELAY_MILLIS)
        for (step in script.split(',').map { it.trim() }.filter { it.isNotEmpty() }) perform(app, step)
    }

    suspend fun perform(app: AppModel, step: String) {
        val parts = step.split(':')
        val argument = parts.getOrNull(1)
        val tabStore = app.tabStore ?: return
        when (parts.first()) {
            "wait" -> delay(((argument?.toDoubleOrNull() ?: 1.0) * 1000).toLong())
            "warm" -> app.warmDemoSnapshots().join()
            "deck" -> {
                app.deck.entrance = TabDeckModel.Entrance.Plain
                app.surface = AppModel.Surface.TabSwitcher
            }
            "open" -> {
                val handoff = demoHandoff(app)
                app.deck.handoff = handoff
                app.deck.entrance = handoff?.let { TabDeckModel.Entrance.FromPage(it.tabId) } ?: TabDeckModel.Entrance.Plain
                app.surface = AppModel.Surface.TabSwitcher
            }
            "snapall" -> {
                val ids = app.deckOrder.takeLast(argument?.toIntOrNull() ?: 6).map { it.id }
                for (id in ids) {
                    app.openTab(id)
                    delay(SNAP_WAIT_MILLIS)
                    app.captureSnapshot(id).join()
                }
                ids.lastOrNull()?.let(app::openTab)
            }
            "switcher" -> app.showTabSwitcher()
            "browse" -> app.tabs.selectedTabId?.let(app::openTab)
            "scroll" -> app.deck.command = TabDeckModel.Command(TabDeckModel.Command.Kind.Scroll(argument?.toIntOrNull() ?: 0))
            "close" -> app.deck.command = TabDeckModel.Command(TabDeckModel.Command.Kind.CloseFocused)
            "tap" -> app.deck.command = TabDeckModel.Command(TabDeckModel.Command.Kind.OpenFocused)
            "archivecard" -> {
                app.deck.hasShownArchiveCard = false
                app.deck.command = TabDeckModel.Command(TabDeckModel.Command.Kind.ShowArchiveCard)
            }
            "incognito" -> {
                if (!app.allowsIncognito()) return
                for (url in listOf("https://en.wikipedia.org/wiki/Moon", "https://www.apple.com/")) tabStore.open(TabDestination.Url(url), isPrivate = true)
                app.deck.entrance = TabDeckModel.Entrance.Plain
                app.surface = AppModel.Surface.TabSwitcher
            }
            "lift" -> app.deck.command = TabDeckModel.Command(TabDeckModel.Command.Kind.Lift(argument?.toDoubleOrNull() ?: -120.0))
            "keep" -> app.deckOrder.dropLast(argument?.toIntOrNull() ?: 3).forEach { tabStore.close(it.id) }
            "private" -> {
                if (!app.allowsIncognito()) return
                val tab = tabStore.open(TabDestination.Url("https://en.wikipedia.org/wiki/Moon"), selecting = false, isPrivate = true)
                tabStore.update(tab.id, title = "Moon - Wikipedia")
            }
            "empty" -> {
                tabStore.closeAll()
                app.deck.entrance = TabDeckModel.Entrance.Plain
                app.surface = AppModel.Surface.TabSwitcher
            }
            "archive" -> app.sheet = AppModel.Sheet.Archive
            "spaces" -> app.sheet = AppModel.Sheet.SyncedSpaces
            "received" -> tabStore.receive(
                listOf(
                    IncomingTab(
                        key = "demo-received-${UUID.randomUUID()}",
                        url = "https://www.swift.org/blog/",
                        title = "Blog | Swift.org",
                        fromDevice = "MacBook Pro",
                        sentAt = System.currentTimeMillis(),
                        profileSyncId = "demo-personal",
                    ),
                ),
            )
            "many" -> repeat(argument?.toIntOrNull() ?: 50) { index ->
                val tab = tabStore.open(TabDestination.Url("https://en.wikipedia.org/wiki/Special:Random?n=$index"), selecting = false)
                val title = if (index % 7 == 0) {
                    "An exceptionally long article title that keeps going well past eighty characters to test truncation $index"
                } else {
                    "Article ${index + 1}"
                }
                tabStore.update(tab.id, title = title)
            }
        }
    }

    private suspend fun demoHandoff(app: AppModel): TabDeckModel.Handoff? {
        val tab = app.tabs.selectedTab ?: return null
        val image = app.pages[tab.id]?.snapshot() ?: drawnPage(tab.title.ifEmpty { tab.url })
        return TabDeckModel.Handoff(tab.id, image)
    }

    private fun drawnPage(title: String): Bitmap {
        val width = 393 * 2
        val height = 852 * 2
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(0xFFFFFFFF.toInt())
        paint.color = 0xFF3038FA.toInt()
        canvas.drawRect(0f, 0f, width.toFloat(), 320f, paint)
        paint.color = 0xFF000000.toInt()
        paint.textSize = 60f
        paint.isFakeBoldText = true
        canvas.drawText(title.take(28), 40f, 440f, paint)
        paint.color = 0x1F787880
        for (row in 0 until 12) {
            val right = if (row % 3 == 0) 480f else width - 40f
            canvas.drawRect(40f, 660f + row * 68f, right, 688f + row * 68f, paint)
        }
        return bitmap
    }
}
