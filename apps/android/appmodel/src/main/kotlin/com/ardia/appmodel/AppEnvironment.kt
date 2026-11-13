package com.ardia.appmodel

import android.content.Context
import com.ardia.blocking.BlockingStore
import com.ardia.blocking.FilterLists
import com.ardia.blocking.HttpFilterListDownloader
import com.ardia.blocking.InMemoryBlockingStore
import com.ardia.blocking.SharedPreferencesBlockingStore
import com.ardia.browser.DevelopmentWebViewEngine
import com.ardia.browser.PageEngine
import com.ardia.browser.SitePreferences
import com.ardia.store.BrowserStore
import com.ardia.store.CoreScript
import com.ardia.store.HermesCoreScript
import com.ardia.store.KeyValueStore
import com.ardia.store.MemoryKeyValueStore
import com.ardia.store.SharedPreferencesStore
import com.ardia.sync.SyncController
import java.io.File
import kotlin.concurrent.thread
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

class AppEnvironment(
    val isDemo: Boolean,
    val preferences: KeyValueStore,
    val blockingStore: BlockingStore,
    val openStore: suspend () -> BrowserStore,
    val makeEngine: (SitePreferences) -> PageEngine,
    val makeSync: () -> SyncController,
    val makeFilterLists: (BlockingStore) -> FilterLists,
    val coreScript: () -> CoreScript,
    val omniboxDirectory: File?,
    val system: SystemActions,
    val workDispatcher: CoroutineDispatcher = Dispatchers.Default,
) {
    val refreshesFromNetwork: Boolean get() = !isDemo

    companion object {
        const val BLOCKING_PREFERENCES = "ardia.blocking"
        const val BLOCKING_FOLDER = "Blocking"
        const val DEMO_BLOCKING_FOLDER = "DemoBlocking"

        fun preloadPreferences(context: Context): Thread {
            val app = context.applicationContext
            return thread(name = "ArdiaPreferences", isDaemon = true) {
                app.getSharedPreferences(BrowserStore.PREFERENCES_NAME, Context.MODE_PRIVATE).all
                app.getSharedPreferences(BLOCKING_PREFERENCES, Context.MODE_PRIVATE).all
            }
        }

        fun forApp(context: Context, isDemo: Boolean): AppEnvironment {
            val app = context.applicationContext
            val system = AndroidSystemActions(app)
            if (isDemo) {
                return AppEnvironment(
                    isDemo = true,
                    preferences = MemoryKeyValueStore(),
                    blockingStore = InMemoryBlockingStore(),
                    openStore = { BrowserStore.demo(app) },
                    makeEngine = { preferences -> DevelopmentWebViewEngine(app, preferences) },
                    makeSync = { SyncController.demo() },
                    makeFilterLists = { store -> FilterLists.demo(File(File(app.cacheDir, DEMO_BLOCKING_FOLDER), "Filters"), store) },
                    coreScript = { HermesCoreScript(app.assets) },
                    omniboxDirectory = null,
                    system = system,
                )
            }
            return AppEnvironment(
                isDemo = false,
                preferences = SharedPreferencesStore(app.getSharedPreferences(BrowserStore.PREFERENCES_NAME, Context.MODE_PRIVATE)),
                blockingStore = SharedPreferencesBlockingStore(app.getSharedPreferences(BLOCKING_PREFERENCES, Context.MODE_PRIVATE)),
                openStore = { BrowserStore.open(app) },
                makeEngine = { preferences -> DevelopmentWebViewEngine(app, preferences) },
                makeSync = { SyncController.forApp(app) },
                makeFilterLists = { store -> FilterLists(File(File(app.cacheDir, BLOCKING_FOLDER), "Filters"), store, HttpFilterListDownloader()) },
                coreScript = { HermesCoreScript(app.assets) },
                omniboxDirectory = BrowserStore.omniboxDirectory(app),
                system = system,
            )
        }
    }
}
