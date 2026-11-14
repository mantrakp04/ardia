package com.ardia.phone

import android.content.Context
import com.ardia.sync.LocalBrowsingSource
import com.ardia.sync.SyncController
import com.ardia.sync.SyncFiles
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object PhoneSync {
    const val DEMO_EXTRA = "com.ardia.phone.SYNC_DEMO"
    private const val RETIRE_TIMEOUT_MILLIS = 10_000L

    internal var makeController: (Context, LocalBrowsingSource) -> SyncController = { app, source -> SyncController.forApp(app, source) }
    internal var makeDemo: () -> SyncController = { SyncController.demo() }
    internal var makeRows: (File) -> BrowserRows = ::SqliteBrowserRows
    internal var labBuild: Boolean = PhoneLab.isOn

    @Volatile
    private var made: SyncController? = null
        set(value) {
            field = value
            mutableControllers.value = value
        }

    private val mutableControllers = MutableStateFlow<SyncController?>(null)

    val controllers: StateFlow<SyncController?> = mutableControllers.asStateFlow()

    @Volatile
    private var madeInbox: PhoneInbox? = null

    @Volatile
    private var madeSource: PhoneBrowsingSource? = null

    @Volatile
    var isDemo: Boolean = false
        private set

    fun current(): SyncController? = made

    fun controller(context: Context, demo: Boolean? = null): SyncController = synchronized(this) {
        val current = made
        val app = context.applicationContext ?: context
        val wanted = when {
            demo != true -> demo
            !labBuild -> false
            isDemo -> true
            current?.state?.value?.isEnabled == true || connectedOnDisk(app) -> null
            else -> true
        }
        if (current != null && (wanted == null || wanted == isDemo)) return current
        if (current != null) {
            check(android.os.Looper.myLooper()?.let { it != android.os.Looper.getMainLooper() } ?: true) { "sync is replaced off the main thread" }
            made = null
            if (!current.closeAndWait(RETIRE_TIMEOUT_MILLIS)) throw IllegalStateException("the sync engine being replaced did not stop in time")
        }
        val wantsDemo = wanted == true
        val fresh = if (wantsDemo) makeDemo() else makeController(app, source(app))
        fresh.start()
        isDemo = wantsDemo
        made = fresh
        fresh
    }

    fun inbox(context: Context): PhoneInbox = madeInbox ?: synchronized(this) {
        val app = context.applicationContext ?: context
        madeInbox ?: PhoneInbox(File(File(app.noBackupFilesDir, "PhoneSync"), "inbox.json")).also { madeInbox = it }
    }

    internal fun source(context: Context): PhoneBrowsingSource = madeSource ?: synchronized(this) {
        madeSource ?: PhoneBrowsingSource(makeRows(database(context)), inbox(context)).also { madeSource = it }
    }

    internal fun forgetForTests() = synchronized(this) {
        made?.closeAndWait(RETIRE_TIMEOUT_MILLIS)
        made = null
        madeInbox = null
        madeSource = null
        isDemo = false
        labBuild = PhoneLab.isOn
    }

    private fun connectedOnDisk(app: Context): Boolean = SyncFiles(File(app.noBackupFilesDir, "Sync")).loadMeta().enabled

    private fun database(app: Context) = File(File(app.filesDir, "SQLite"), "browser.db")
}
