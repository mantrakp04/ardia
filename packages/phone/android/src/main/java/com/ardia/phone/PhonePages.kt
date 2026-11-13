package com.ardia.phone

import android.app.Activity
import android.content.Context
import com.ardia.browser.DevelopmentWebViewEngine
import com.ardia.browser.PageEngine

object PhonePages {
    private var shared: PageEngine? = null

    fun engine(context: Context): PageEngine = shared ?: DevelopmentWebViewEngine(context).also {
        shared = it
        it.warmUp()
    }

    fun attach(activity: Activity) = engine(activity).attach(activity)

    fun detach(activity: Activity) = shared?.detach(activity)

    fun close(id: String) = shared?.close(id)
}
