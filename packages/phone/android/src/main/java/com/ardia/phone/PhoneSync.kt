package com.ardia.phone

import android.content.Context
import com.ardia.sync.LocalBrowsingSource
import com.ardia.sync.SyncController
import java.io.File

object PhoneSync {
    const val DEMO_EXTRA = "com.ardia.phone.SYNC_DEMO"

    internal var makeController: (Context, LocalBrowsingSource) -> SyncController = { app, source -> SyncController.forApp(app, source) }
    internal var makeDemo: () -> SyncController = { SyncController.demo() }
    internal var makeRows: (File) -> BrowserRows = ::SqliteBrowserRows

    @Volatile
    private var made: SyncController? = null

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
        if (current != null && (demo == null || demo == isDemo)) return current
        current?.close()
        val app = context.applicationContext ?: context
        val wantsDemo = demo == true
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
        made?.close()
        made = null
        madeInbox = null
        madeSource = null
        isDemo = false
    }

    private fun database(app: Context) = File(File(app.filesDir, "SQLite"), "browser.db")
}
