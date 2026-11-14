package com.ardia.phone

import android.Manifest
import android.content.Context
import com.ardia.settings.CameraAccessCheck
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ScanModule : Module() {
    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneScan")

        AsyncFunction("permission") { promise: Promise -> answer(promise, ask = false) }

        AsyncFunction("requestPermission") { promise: Promise -> answer(promise, ask = true) }

        View(ScanView::class) {
            Events("onCode", "onRejected", "onError")

            Prop("active") { view: ScanView, active: Boolean? -> view.isActive = active ?: true }

            OnViewDidUpdateProps { view -> view.update() }
        }
    }

    private fun answer(promise: Promise, ask: Boolean) {
        if (!CameraAccessCheck.hasCamera(context)) {
            promise.resolve(mapOf("status" to "unsupported", "canAskAgain" to false))
            return
        }
        val manager = appContext.permissions
        if (manager == null) {
            promise.resolve(mapOf("status" to if (CameraAccessCheck.isGranted(context)) "granted" else "denied", "canAskAgain" to false))
            return
        }
        val listener = expo.modules.interfaces.permissions.PermissionsResponseListener { results ->
            val result = results[Manifest.permission.CAMERA]
            val granted = result?.status == PermissionsStatus.GRANTED
            val status = when {
                granted -> "granted"
                result?.status == PermissionsStatus.UNDETERMINED -> "undetermined"
                else -> "denied"
            }
            promise.resolve(mapOf("status" to status, "canAskAgain" to (result?.canAskAgain ?: false)))
        }
        if (ask) manager.askForPermissions(listener, Manifest.permission.CAMERA) else manager.getPermissions(listener, Manifest.permission.CAMERA)
    }
}
