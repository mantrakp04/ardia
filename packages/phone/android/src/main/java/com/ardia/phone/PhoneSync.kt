package com.ardia.phone

import android.content.Context
import com.ardia.sync.SyncController
import java.io.File

object PhoneSync {
    const val DEMO_EXTRA = "com.ardia.phone.SYNC_DEMO"

    @Volatile
    private var made: SyncController? = null

    @Volatile
    private var madeInbox: PhoneInbox? = null

    @Volatile
    var isDemo: Boolean = false
        private set

    fun controller(context: Context, demo: Boolean? = null): SyncController = synchronized(this) {
        val current = made
        if (current != null && (demo == null || demo == isDemo)) return current
        current?.close()
        val app = context.applicationContext
        inbox(app)
        val wantsDemo = demo == true
        val fresh = if (wantsDemo) SyncController.demo() else SyncController.forApp(app, PhoneBrowsingSource(SqliteBrowserRows(database(app)), madeInbox!!))
        fresh.start()
        isDemo = wantsDemo
        made = fresh
        fresh
    }

    fun inbox(context: Context): PhoneInbox = madeInbox ?: synchronized(this) {
        madeInbox ?: PhoneInbox(File(File(context.applicationContext.noBackupFilesDir, "PhoneSync"), "inbox.json")).also { madeInbox = it }
    }

    private fun database(app: Context) = File(File(app.filesDir, "SQLite"), "browser.db")
}
