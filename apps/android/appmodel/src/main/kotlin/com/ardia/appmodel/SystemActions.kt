package com.ardia.appmodel

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.ardia.browser.DownloadOutcome
import com.ardia.browser.DownloadProgress
import com.ardia.browser.PageEngine
import com.ardia.browser.PageDownload
import com.ardia.browser.SystemDownloads
import java.util.Locale
import kotlinx.coroutines.flow.Flow

interface SystemActions {
    val downloadOutcomes: Flow<DownloadOutcome>

    val activeDownloads: Flow<List<DownloadProgress>>

    fun useEngine(engine: PageEngine) = Unit

    fun cancelDownload(id: Long) = Unit

    fun copyText(text: String)

    fun share(url: String, title: String)

    fun shareText(text: String, subject: String? = null)

    fun browserRoleRequest(): Intent?

    fun defaultAppsSettings(): Intent

    fun openExternal(url: String): Boolean

    fun openDownloaded(outcome: DownloadOutcome.Finished)

    fun enqueueDownload(download: PageDownload): Long?

    fun isDefaultBrowser(): Boolean?

    fun preferredLanguage(): String
}

class AndroidSystemActions(context: Context) : SystemActions {
    private val app = context.applicationContext
    @Volatile
    private var engine: PageEngine? = null
    private val currentEngine: () -> PageEngine? = { engine }
    private val downloads: SystemDownloads by lazy { SystemDownloads(app, currentEngine) }

    override val downloadOutcomes: Flow<DownloadOutcome> get() = downloads.outcomes

    override val activeDownloads: Flow<List<DownloadProgress>> get() = downloads.active

    override fun useEngine(engine: PageEngine) {
        this.engine = engine
    }

    override fun cancelDownload(id: Long) = downloads.cancel(id)

    override fun copyText(text: String) {
        val clipboard = app.getSystemService(ClipboardManager::class.java) ?: return
        clipboard.setPrimaryClip(ClipData.newPlainText("URL", text))
    }

    override fun share(url: String, title: String) {
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, url)
            .putExtra(Intent.EXTRA_TITLE, title)
        start(Intent.createChooser(send, null))
    }

    override fun shareText(text: String, subject: String?) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        subject?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
        start(Intent.createChooser(send, null))
    }

    override fun browserRoleRequest(): Intent? {
        val roles = app.getSystemService(RoleManager::class.java) ?: return null
        if (!roles.isRoleAvailable(RoleManager.ROLE_BROWSER) || roles.isRoleHeld(RoleManager.ROLE_BROWSER)) return null
        return roles.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
    }

    override fun defaultAppsSettings(): Intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)

    override fun openExternal(url: String): Boolean = start(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))

    override fun openDownloaded(outcome: DownloadOutcome.Finished) {
        val uri = outcome.uri ?: return
        start(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    override fun enqueueDownload(download: PageDownload): Long? = downloads.enqueue(download)

    override fun isDefaultBrowser(): Boolean? {
        val roles = app.getSystemService(RoleManager::class.java) ?: return null
        if (!roles.isRoleAvailable(RoleManager.ROLE_BROWSER)) return null
        return roles.isRoleHeld(RoleManager.ROLE_BROWSER)
    }

    override fun preferredLanguage(): String = Locale.getDefault().language.ifEmpty { "en" }

    private fun start(intent: Intent): Boolean = try {
        app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (missing: ActivityNotFoundException) {
        false
    } catch (refused: SecurityException) {
        false
    }
}
