package com.ardia.phone

import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SystemModule : Module() {
    private var listener: PhoneSystemLinks.Listener? = null

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneSystem")

        Events("onSystemLink")

        OnStartObserving("onSystemLink") {
            listener?.let(PhoneSystemLinks::stopListening)
            listener = PhoneSystemLinks.listen { payload -> sendEvent("onSystemLink", payload) }
        }

        OnStopObserving("onSystemLink") {
            listener?.let(PhoneSystemLinks::stopListening)
            listener = null
        }

        OnDestroy {
            listener?.let(PhoneSystemLinks::stopListening)
            listener = null
        }

        OnActivityEntersForeground {
            appContext.reactContext?.applicationContext?.let { app -> PhoneA11yDump.listen(app) { appContext.currentActivity } }
        }

        OnActivityEntersBackground { PhoneA11yDump.stopListening() }

        AsyncFunction("initialLink") { -> PhoneSystemLinks.takeInitial() }

        AsyncFunction("setHidesFromRecents") { hidden: Boolean ->
            val activity = appContext.currentActivity ?: return@AsyncFunction false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.setRecentsScreenshotEnabled(!hidden)
            } else if (hidden) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            true
        }.runOnQueue(Queues.MAIN)
    }
}
