package com.ardia.browser.android

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.snapshotFlow
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import com.ardia.appmodel.AppModel
import com.ardia.browser.android.system.ArdiaWidgets
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    lateinit var model: AppModel
        private set
    private var uiMode = 0
    private var wasActive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        val createdAt = SystemClock.uptimeMillis()
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        uiMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        model = ArdiaApplication.of(this).model(SystemIntents.launchArguments(this, intent))
        model.attach(this)
        lifecycle.addObserver(sceneObserver)
        StartupTiming.watchFirstFrame(window.decorView, createdAt)
        setContent { ArdiaRoot(model, createdAt) }
        lifecycleScope.launch {
            snapshotFlow { model.isPrivateOnScreen }.distinctUntilChanged().collect(::hideFromRecents)
        }
        if (savedInstanceState == null) deliver(intent)
    }

    private val sceneObserver = LifecycleEventObserver { _, event ->
        when (event) {
            Lifecycle.Event.ON_RESUME -> {
                wasActive = true
                model.sceneBecameActive()
            }
            Lifecycle.Event.ON_PAUSE -> if (wasActive) {
                wasActive = false
                model.sceneWillResignActive()
            }
            Lifecycle.Event.ON_STOP -> model.sceneEnteredBackground()
            else -> Unit
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deliver(intent)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val night = newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK
        if (night == uiMode) return
        uiMode = night
        if (model.isDemo) return
        val app = ArdiaApplication.of(this)
        app.appScope.launch { ArdiaWidgets.refreshSearch(app) }
    }

    override fun onDestroy() {
        lifecycle.removeObserver(sceneObserver)
        model.detach(this)
        super.onDestroy()
    }

    private fun hideFromRecents(hidden: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(!hidden)
        } else if (hidden) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    private fun deliver(intent: Intent?) {
        SystemEntry.from(intent)?.deliver(model)
    }
}
