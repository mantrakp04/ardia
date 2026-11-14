package com.ardia.browser.android

import android.app.Application
import android.content.Context
import android.content.pm.ApplicationInfo
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.AppEnvironment
import com.ardia.appmodel.LaunchArguments
import com.ardia.sync.SyncController
import com.ardia.sync.SyncControllerOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class ArdiaApplication : Application(), SyncControllerOwner {
    val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val lock = Any()

    @Volatile
    private var current: AppModel? = null

    override fun onCreate() {
        super.onCreate()
        AppEnvironment.preloadPreferences(this)
        StartupTiming.applicationCreated()
    }

    val existingModel: AppModel? get() = current

    val acceptsLaunchArguments: Boolean get() = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    fun model(launch: LaunchArguments = LaunchArguments.none): AppModel = synchronized(lock) {
        val made = current
        if (made != null && (launch == LaunchArguments.none || launch == made.launch)) return made
        made?.close()
        AppModel(launch, AppEnvironment.forApp(this, launch.isDemo)).also { current = it }
    }

    fun discardModel() {
        synchronized(lock) {
            current?.close()
            current = null
        }
    }

    override val syncController: SyncController get() = model().sync

    companion object {
        fun of(context: Context): ArdiaApplication = context.applicationContext as ArdiaApplication
    }
}
