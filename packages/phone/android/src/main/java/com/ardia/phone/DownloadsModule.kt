package com.ardia.phone

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DownloadsModule : Module() {
    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneDownloads")

        Events("onDownloadEvent")

        OnCreate {
            PhonePages.downloadSink = { sendEvent("onDownloadEvent", it) }
        }

        OnDestroy {
            PhonePages.downloadSink = null
        }

        AsyncFunction("active") { ->
            PhonePages.engine(context)
            PhonePages.downloads.active.value.map {
                mapOf(
                    "id" to it.id.toString(),
                    "fileName" to it.fileName,
                    "bytes" to it.bytes.toDouble(),
                    "total" to it.total?.toDouble(),
                    "fraction" to it.fraction?.toDouble(),
                    "isQueued" to it.isQueued,
                )
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("cancel") { id: String ->
            PhonePages.engine(context)
            id.toLongOrNull()?.let(PhonePages.downloads::cancel)
            Unit
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("open") { uri: String ->
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                (appContext.currentActivity ?: context).startActivity(intent)
                true
            } catch (missing: ActivityNotFoundException) {
                false
            } catch (refused: SecurityException) {
                false
            }
        }.runOnQueue(Queues.MAIN)
    }
}
