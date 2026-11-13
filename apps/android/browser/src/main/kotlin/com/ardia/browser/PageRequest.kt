package com.ardia.browser

import android.content.Context
import android.net.Uri
import java.util.concurrent.atomic.AtomicLong

enum class SitePermission {
    Camera,
    Microphone,
    CameraAndMicrophone,
    Location,
}

class PageRequest internal constructor(val kind: Kind, val host: String, completion: (Answer) -> Unit) {
    sealed interface Kind {
        data class Alert(val message: String) : Kind

        data class Confirm(val message: String) : Kind

        data class Prompt(val message: String, val defaultText: String) : Kind

        data class OpenExternal(val url: String, val app: ExternalApp) : Kind

        data class HttpAuthentication(val realm: String?, val isProxy: Boolean, val failedBefore: Boolean, val isSecure: Boolean) : Kind

        data class Permission(val permission: SitePermission) : Kind

        data class FileChooser(val acceptTypes: List<String>, val allowsMultiple: Boolean, val prefersCapture: Boolean) : Kind
    }

    sealed interface Answer {
        data object Dismissed : Answer

        data object Accepted : Answer

        data class Text(val text: String) : Answer

        data class Credential(val user: String, val password: String) : Answer

        data class Files(val uris: List<Uri>) : Answer
    }

    val id: Long = nextId.incrementAndGet()
    private var completion: ((Answer) -> Unit)? = completion

    @Volatile
    var isAnswered: Boolean = false
        private set

    fun answer(answer: Answer) {
        val completion = synchronized(this) { completion.also { this.completion = null } } ?: return
        isAnswered = true
        completion(answer)
    }

    fun dismiss() = answer(Answer.Dismissed)

    fun title(context: Context): String = when (val kind = kind) {
        is Kind.Alert, is Kind.Confirm, is Kind.Prompt ->
            if (host.isEmpty()) context.getString(R.string.request_this_page_says) else host
        is Kind.OpenExternal -> context.getString(R.string.request_open_in_app, appName(context, kind.app))
        is Kind.HttpAuthentication ->
            if (kind.isProxy) context.getString(R.string.request_proxy_sign_in) else context.getString(R.string.request_sign_in_to, host)
        is Kind.Permission -> context.getString(
            when (kind.permission) {
                SitePermission.Camera -> R.string.request_camera
                SitePermission.Microphone -> R.string.request_microphone
                SitePermission.CameraAndMicrophone -> R.string.request_camera_and_microphone
                SitePermission.Location -> R.string.request_location
            },
            host,
        )
        is Kind.FileChooser -> context.getString(if (kind.allowsMultiple) R.string.request_choose_files else R.string.request_choose_file)
    }

    fun message(context: Context): String? = when (val kind = kind) {
        is Kind.Alert -> kind.message
        is Kind.Confirm -> kind.message
        is Kind.Prompt -> kind.message
        is Kind.OpenExternal -> if (BrowserUrl.scheme(kind.url) == "tel") kind.url.substringAfter(':').substringBefore('?') else null
        is Kind.HttpAuthentication -> when {
            kind.failedBefore -> context.getString(R.string.request_sign_in_failed)
            !kind.isSecure -> context.getString(R.string.request_sign_in_unencrypted)
            else -> kind.realm?.let { context.getString(R.string.request_sign_in_secure, it) }
        }
        is Kind.Permission, is Kind.FileChooser -> null
    }

    companion object {
        private val nextId = AtomicLong()

        fun appName(context: Context, app: ExternalApp): String = context.getString(
            when (app) {
                ExternalApp.Phone -> R.string.app_phone
                ExternalApp.Email -> R.string.app_email
                ExternalApp.Messages -> R.string.app_messages
                ExternalApp.Maps -> R.string.app_maps
                ExternalApp.Store -> R.string.app_store
                ExternalApp.Other -> R.string.app_other
            },
        )
    }
}
