package com.ardia.browser.android

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import com.ardia.phone.PhoneSystemLinks
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
    private var nightMode = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
        nightMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        PhoneSystemLinks.receive(intent, restored = savedInstanceState != null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        PhoneSystemLinks.receive(intent)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val night = newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK
        if (night == nightMode) return
        nightMode = night
        SystemExport.nightModeChanged(this)
    }

    override fun getMainComponentName(): String = "main"

    override fun createReactActivityDelegate(): ReactActivityDelegate = ReactActivityDelegateWrapper(
        this,
        BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
        object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {},
    )

    override fun invokeDefaultOnBackPressed() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R && moveTaskToBack(false)) return
        super.invokeDefaultOnBackPressed()
    }
}
