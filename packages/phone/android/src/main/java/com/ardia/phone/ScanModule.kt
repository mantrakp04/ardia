package com.ardia.phone

import android.Manifest
import android.content.Context
import androidx.core.app.ActivityCompat
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

    private val asked get() = context.getSharedPreferences(ASKED, Context.MODE_PRIVATE)

    private fun rationale(): Boolean = appContext.currentActivity?.let { ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.CAMERA) } == true

    private fun reply(promise: Promise, answer: ScanAccess.Answer) = promise.resolve(mapOf("status" to answer.status, "canAskAgain" to answer.canAskAgain))

    private fun answer(promise: Promise, ask: Boolean) {
        if (!CameraAccessCheck.hasCamera(context)) {
            reply(promise, ScanAccess.Answer("unsupported", false))
            return
        }
        val granted = CameraAccessCheck.isGranted(context)
        if (granted) asked.edit().remove(DENIED_FOR_GOOD).apply()
        val manager = appContext.permissions
        if (!ask || granted || manager == null) {
            reply(promise, ScanAccess.status(granted, rationale(), asked.getBoolean(DENIED_FOR_GOOD, false)))
            return
        }
        manager.askForPermissions({ results ->
            val nowGranted = results[Manifest.permission.CAMERA]?.status == PermissionsStatus.GRANTED
            val nowRationale = rationale()
            asked.edit().putBoolean(DENIED_FOR_GOOD, ScanAccess.deniedForGoodAfterAsking(nowGranted, nowRationale)).apply()
            reply(promise, ScanAccess.status(nowGranted, nowRationale, ScanAccess.deniedForGoodAfterAsking(nowGranted, nowRationale)))
        }, Manifest.permission.CAMERA)
    }

    private companion object {
        const val ASKED = "ardia.scan"
        const val DENIED_FOR_GOOD = "camera.deniedForGood"
    }
}
