package com.ardia.browser.android.system

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import com.ardia.appmodel.AppModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged

private fun snapshotOf(model: AppModel): SystemSnapshot = SystemSnapshots.of(model.syncState, model.syncSnapshot, model.selectedProfile, model.settings.colorChoice)

private fun storeFor(context: Context, model: AppModel): SystemStore = if (model.isDemo) SystemStore.demo(context) else SystemStore.shared(context)

@Composable
fun SystemSnapshotExport(model: AppModel) {
    val context = LocalContext.current.applicationContext
    LaunchedEffect(model) {
        val exporter = SystemSnapshotExporter(context, storeFor(context, model), publishes = !model.isDemo)
        snapshotFlow { snapshotOf(model) }.distinctUntilChanged().collectLatest { exporter.export(it) }
    }
}
