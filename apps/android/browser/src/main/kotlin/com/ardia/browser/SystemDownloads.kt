package com.ardia.browser

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch

sealed interface DownloadOutcome {
    val fileName: String

    data class Finished(override val fileName: String, val uri: Uri?) : DownloadOutcome

    data class Failed(override val fileName: String) : DownloadOutcome
}

class SystemDownloads(context: Context) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(DownloadManager::class.java)
    private val active = ConcurrentHashMap<Long, String>()

    fun enqueue(download: PageDownload): Long? {
        if (!BrowserUrl.isWeb(download.url)) return null
        val request = DownloadManager.Request(Uri.parse(download.url))
            .setTitle(download.fileName)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, download.fileName)
        download.mimeType?.let(request::setMimeType)
        download.cookies?.let { request.addRequestHeader("Cookie", it) }
        download.userAgent?.let { request.addRequestHeader("User-Agent", it) }
        download.referer?.let { request.addRequestHeader("Referer", it) }
        val id = runCatching { manager.enqueue(request) }.getOrNull() ?: return null
        active[id] = download.fileName
        return id
    }

    val outcomes: Flow<DownloadOutcome> = callbackFlow {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                val name = active.remove(id) ?: return
                launch(Dispatchers.IO) { send(outcome(id, name)) }
            }
        }
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            appContext.registerReceiver(receiver, filter)
        }
        awaitClose { appContext.unregisterReceiver(receiver) }
    }

    private fun outcome(id: Long, name: String): DownloadOutcome {
        val succeeded = runCatching {
            manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
                cursor.moveToFirst() && cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL
            }
        }.getOrDefault(false)
        return if (succeeded) DownloadOutcome.Finished(name, manager.getUriForDownloadedFile(id)) else DownloadOutcome.Failed(name)
    }
}
