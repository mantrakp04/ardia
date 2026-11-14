package com.ardia.phone

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.ardia.browser.OnlineAgain
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NetworkModule : Module() {
    private var callback: ConnectivityManager.NetworkCallback? = null

    private val connectivity: ConnectivityManager? get() = appContext.reactContext?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneNetwork")

        Events("onNetwork")

        Function("isOnline") {
            val manager = connectivity ?: return@Function true
            manager.getNetworkCapabilities(manager.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        }

        OnStartObserving("onNetwork") { watch() }

        OnStopObserving("onNetwork") { unwatch() }

        OnDestroy { unwatch() }
    }

    private fun watch() {
        val manager = connectivity ?: return
        unwatch()
        val online = OnlineAgain(startedOffline = manager.activeNetwork == null)
        val listener = object : ConnectivityManager.NetworkCallback() {
            override fun onLost(network: Network) {
                online.lost()
                runCatching { sendEvent("onNetwork", mapOf("online" to false)) }
            }

            override fun onAvailable(network: Network) {
                if (online.available()) runCatching { sendEvent("onNetwork", mapOf("online" to true)) }
            }
        }
        if (runCatching { manager.registerDefaultNetworkCallback(listener) }.isSuccess) callback = listener
    }

    private fun unwatch() {
        val listener = callback ?: return
        callback = null
        runCatching { connectivity?.unregisterNetworkCallback(listener) }
    }
}
