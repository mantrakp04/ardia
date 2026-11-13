package com.ardia.browser

import android.content.Context
import android.webkit.WebViewClient

enum class NetworkFailure {
    Offline,
    HostNotFound,
    TimedOut,
    ConnectionLost,
    NotPrivate,
    Other,
    ;

    companion object {
        internal fun fromWebViewError(code: Int, isOnline: Boolean): NetworkFailure = when (code) {
            WebViewClient.ERROR_HOST_LOOKUP -> if (isOnline) HostNotFound else Offline
            WebViewClient.ERROR_CONNECT, WebViewClient.ERROR_IO -> if (isOnline) ConnectionLost else Offline
            WebViewClient.ERROR_TIMEOUT -> if (isOnline) TimedOut else Offline
            WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> NotPrivate
            else -> if (isOnline) Other else Offline
        }
    }
}

sealed interface PageLoadFailure {
    data object Crashed : PageLoadFailure

    data class Network(val reason: NetworkFailure) : PageLoadFailure

    fun title(context: Context): String = context.getString(
        when {
            this is Crashed -> R.string.failure_crashed_title
            this is Network && reason == NetworkFailure.Offline -> R.string.failure_offline_title
            else -> R.string.failure_network_title
        },
    )

    fun message(context: Context): String = context.getString(
        when (this) {
            is Crashed -> R.string.failure_crashed_message
            is Network -> when (reason) {
                NetworkFailure.Offline -> R.string.failure_offline_message
                NetworkFailure.HostNotFound -> R.string.failure_host_not_found
                NetworkFailure.TimedOut -> R.string.failure_timed_out
                NetworkFailure.ConnectionLost -> R.string.failure_connection_lost
                NetworkFailure.NotPrivate -> R.string.failure_not_private
                NetworkFailure.Other -> R.string.failure_other
            }
        },
    )

    val retriesWhenOnline: Boolean get() = this is Network && reason == NetworkFailure.Offline
}
