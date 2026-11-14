package com.ardia.browser.android

import android.content.Context
import com.ardia.browser.android.system.ArdiaWidgets
import com.ardia.browser.android.system.SystemSnapshotExporter
import com.ardia.browser.android.system.SystemSnapshots
import com.ardia.browser.android.system.SystemStore
import com.ardia.phone.PhoneSync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

object SystemExport {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun start(context: Context) {
        val app = context.applicationContext
        scope.launch {
            PhoneSync.controllers.collectLatest { sync ->
                sync ?: return@collectLatest
                val demo = PhoneSync.isDemo
                val exporter = SystemSnapshotExporter(app, if (demo) SystemStore.demo(app) else SystemStore.shared(app), publishes = !demo)
                combine(sync.state, sync.snapshot, sync.selectedProfile) { state, snapshot, selected -> SystemSnapshots.of(state, snapshot, selected, null) }
                    .distinctUntilChanged()
                    .collectLatest { runCatching { exporter.export(it) } }
            }
        }
    }

    fun nightModeChanged(context: Context) {
        val app = context.applicationContext
        scope.launch { ArdiaWidgets.refreshSearch(app) }
    }
}
