package com.ardia.phone

import android.content.ActivityNotFoundException
import android.content.Context
import com.ardia.appmodel.AndroidSystemActions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DefaultBrowserModule : Module() {
    private var asking: Promise? = null

    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)

    private val system: AndroidSystemActions by lazy { AndroidSystemActions(context) }

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneDefaultBrowser")

        AsyncFunction("status") { -> mapOf("isDefault" to (system.isDefaultBrowser() == true), "canAsk" to (system.browserRoleRequest() != null)) }

        AsyncFunction("requestRole") { promise: Promise ->
            val activity = appContext.currentActivity
            val request = system.browserRoleRequest()
            if (activity == null || request == null || asking != null) {
                promise.resolve(system.isDefaultBrowser() == true)
                return@AsyncFunction
            }
            asking = promise
            try {
                activity.startActivityForResult(request, ROLE_REQUEST)
            } catch (missing: ActivityNotFoundException) {
                asking = null
                promise.resolve(false)
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("openDefaultAppsSettings") { ->
            val activity = appContext.currentActivity ?: throw CodedException("ERR_NO_ACTIVITY", "Ardia isn't on screen", null)
            try {
                activity.startActivity(system.defaultAppsSettings())
            } catch (missing: ActivityNotFoundException) {
                throw CodedException("ERR_NO_SETTINGS", "This phone has no default apps settings page", missing)
            }
        }.runOnQueue(Queues.MAIN)

        OnActivityResult { _, payload ->
            if (payload.requestCode != ROLE_REQUEST) return@OnActivityResult
            val promise = asking ?: return@OnActivityResult
            asking = null
            promise.resolve(system.isDefaultBrowser() == true)
        }
    }

    companion object {
        private const val ROLE_REQUEST = 47_203
    }
}
