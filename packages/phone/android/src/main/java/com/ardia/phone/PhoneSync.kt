package com.ardia.phone

import android.content.Context
import com.ardia.sync.SyncController
import java.io.File

object PhoneSync {
    @Volatile
    private var made: SyncController? = null

    @Volatile
    private var madeInbox: PhoneInbox? = null

    fun controller(context: Context): SyncController = made ?: synchronized(this) {
        made ?: create(context.applicationContext).also { made = it }
    }

    fun inbox(context: Context): PhoneInbox {
        controller(context)
        return madeInbox!!
    }

    private fun create(app: Context): SyncController {
        val inbox = PhoneInbox(File(File(app.noBackupFilesDir, "PhoneSync"), "inbox.json"))
        madeInbox = inbox
        val database = File(File(app.filesDir, "SQLite"), "browser.db")
        val controller = SyncController.forApp(app, PhoneBrowsingSource(SqliteBrowserRows(database), inbox))
        controller.start()
        return controller
    }
}
