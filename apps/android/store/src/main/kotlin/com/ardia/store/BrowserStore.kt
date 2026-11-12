package com.ardia.store

import android.content.Context
import java.io.File
import java.time.ZoneId
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext

class BrowserStore private constructor(
    val tabs: TabStore,
    val browsing: BrowsingPreferences,
    val app: AppPreferences,
    val snapshots: TabSnapshotStore,
    private val database: BrowserDatabase,
    private val queue: StoreQueue,
) : AutoCloseable {
    val history: HistoryStore get() = tabs.history
    val syncSource: SyncBrowsingSource = SyncBrowsingSource(tabs)

    val writeFailure: StateFlow<Throwable?> get() = tabs.writeFailure

    suspend fun flush(): Boolean = tabs.flush()

    override fun close() {
        queue.close()
        database.close()
    }

    companion object {
        const val PREFERENCES_NAME = "ardia.browser"
        const val SNAPSHOT_FOLDER = "TabSnapshots"
        const val OMNIBOX_FOLDER = "Omnibox"

        suspend fun open(
            context: Context,
            clock: StoreClock = StoreClock.system,
            zone: ZoneId = ZoneId.systemDefault(),
            callbackDispatcher: CoroutineDispatcher = Dispatchers.Main,
        ): BrowserStore = withContext(Dispatchers.IO) {
            val settings = SharedPreferencesStore(context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE))
            assemble(BrowserDatabase(context), settings, File(context.cacheDir, SNAPSHOT_FOLDER), StoreQueue(), clock, zone, callbackDispatcher)
        }

        suspend fun demo(
            context: Context,
            clock: StoreClock = StoreClock.system,
            zone: ZoneId = ZoneId.systemDefault(),
            queue: StoreQueue = StoreQueue(),
            callbackDispatcher: CoroutineDispatcher = Dispatchers.Main,
        ): BrowserStore {
            val directory = File(context.cacheDir, "Demo$SNAPSHOT_FOLDER")
            val store = assemble(BrowserDatabase(context, name = null), MemoryKeyValueStore(), directory, queue, clock, zone, callbackDispatcher)
            DemoSeed.seed(store.tabs, clock.now())
            return store
        }

        fun omniboxDirectory(context: Context): File = File(context.filesDir, OMNIBOX_FOLDER)

        private suspend fun assemble(
            database: BrowserDatabase,
            settings: KeyValueStore,
            snapshotDirectory: File,
            queue: StoreQueue,
            clock: StoreClock,
            zone: ZoneId,
            callbackDispatcher: CoroutineDispatcher,
        ): BrowserStore {
            val tabs = TabStore.load(database, settings, queue, clock, zone, callbackDispatcher)
            val browsing = BrowsingPreferences(settings)
            tabs.searchTemplate = SearchTemplates.template(null, browsing.current.searchEngineId)
            return BrowserStore(tabs, browsing, AppPreferences(settings), TabSnapshotStore(snapshotDirectory), database, queue)
        }
    }
}
