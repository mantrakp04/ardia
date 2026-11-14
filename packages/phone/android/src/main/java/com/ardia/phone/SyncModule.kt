package com.ardia.phone

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import com.ardia.sync.ConnectResult
import com.ardia.sync.SyncController
import com.ardia.sync.SyncFolderPick
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class SyncModule : Module() {
    private var scope: CoroutineScope? = null
    private var picking: ((String?) -> Unit)? = null

    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)

    private var watched: SyncController? = null
    private var route: SyncEventRoute? = null

    private val controller: SyncController
        get() {
            val launch = appContext.currentActivity?.intent
            val demo = launch?.getBooleanExtra(PhoneSync.DEMO_EXTRA, false)?.and(PhoneLab.isOn)
            val sync = PhoneSync.controller(context, demo)
            if (watched !== sync) watch(sync)
            return sync
        }

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneSync")

        Events("onSyncEvent")

        OnCreate {
            route = SyncEventRoute(PhoneSync.inbox(context), { event -> sendEvent("onSyncEvent", event) }) { problem ->
                PhoneSync.current()?.let { sync -> SyncPayloads.status(sync.state.value, problem) }
            }
        }

        OnDestroy {
            route?.close()
            route = null
            scope?.cancel()
            scope = null
            watched = null
        }

        OnActivityEntersForeground {
            PhoneSync.current()?.appForegrounded()
        }

        OnActivityEntersBackground {
            PhoneSync.current()?.appBackgrounded()
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != PICK_FOLDER_REQUEST) return@OnActivityResult
            val done = picking ?: return@OnActivityResult
            picking = null
            done(payload.data?.data?.takeIf { payload.resultCode == Activity.RESULT_OK }?.toString())
        }

        AsyncFunction("status") { -> SyncPayloads.status(controller.state.value, PhoneSync.inbox(context).problem) }

        AsyncFunction("view") { ->
            val sync = controller
            SyncPayloads.view(sync.snapshot.value, sync.state.value.selectedProfileId, sync.receivers.value)
        }

        AsyncFunction("incoming") { -> controller.incoming.value.map(SyncPayloads::received) }

        Function("check") { phrase: String -> SyncPayloads.check(com.ardia.sync.SyncJoin.check(phrase)) }

        AsyncFunction("connect") { phrase: String, promise: Promise ->
            pickFolder(promise) { tree ->
                SyncPayloads.connect(tree?.let { controller.connect(phrase, SyncFolderPick.Tree(it)) })
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("changeFolder") { promise: Promise ->
            pickFolder(promise) { tree ->
                SyncPayloads.connect(tree?.let { controller.changeFolder(SyncFolderPick.Tree(it)) })
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("stopSyncing") Coroutine { -> controller.stopSyncing() }

        AsyncFunction("acknowledgeReset") Coroutine { -> controller.acknowledgeReset() }

        AsyncFunction("syncNow") Coroutine { -> controller.syncNow() }

        AsyncFunction("setDeviceName") { name: String -> controller.setDeviceName(name) }

        AsyncFunction("selectProfile") { profileSyncId: String? -> controller.selectProfile(profileSyncId) }

        AsyncFunction("receivers") { profileSyncId: String? -> controller.receivers(profileSyncId).map(SyncPayloads::device) }

        AsyncFunction("send") Coroutine { url: String, title: String, deviceId: String, profileSyncId: String?, fromPrivateTab: Boolean ->
            val sync = controller
            val target = sync.snapshot.value.devices.firstOrNull { it.id == deviceId } ?: return@Coroutine false
            sync.send(url, title, target, profileSyncId, fromPrivateTab = fromPrivateTab)
        }

        AsyncFunction("pinToMac") Coroutine { url: String, title: String, profileSyncId: String?, fromPrivateTab: Boolean ->
            controller.pinToMac(url, title, profileSyncId, fromPrivateTab)
        }

        AsyncFunction("clearIncoming") { -> controller.clearIncoming() }

        Function("localDidChange") { PhoneSync.current()?.localDidChange() }

        AsyncFunction("inbox") { -> SyncPayloads.inbox(PhoneSync.inbox(context).entries()) }

        AsyncFunction("runtimeChecks") { ->
            SyncRuntimeChecks.run(context.assets).map { mapOf("name" to it.name, "pass" to it.pass, "actual" to it.actual, "expected" to it.expected) }
        }

        AsyncFunction("inboxApplied") { ids: List<Double> -> PhoneSync.inbox(context).applied(ids.map { it.toLong() }.toSet()) }
    }

    private fun watch(sync: SyncController) {
        scope?.cancel()
        watched = sync
        val events = route ?: return
        val inbox = PhoneSync.inbox(context)
        val running = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        scope = running
        running.launch {
            sync.state.collectLatest { state ->
                events.emit(mapOf("name" to "sync.status", "status" to SyncPayloads.status(state, inbox.problem)))
                while (SyncPayloads.wordsAge(state)) {
                    delay(AGE_REFRESH_MILLIS)
                    events.emit(mapOf("name" to "sync.status", "status" to SyncPayloads.status(state, inbox.problem)))
                }
            }
        }
        running.launch {
            combine(sync.snapshot, sync.state, sync.receivers) { snapshot, state, receivers -> SyncPayloads.view(snapshot, state.selectedProfileId, receivers) }
                .collect { events.emit(mapOf("name" to "sync.view", "view" to it)) }
        }
        running.launch {
            sync.incoming.collect { tabs ->
                if (tabs.isNotEmpty()) events.emit(mapOf("name" to "sync.incoming", "tabs" to tabs.map(SyncPayloads::received)))
            }
        }
    }

    private fun pickFolder(promise: Promise, then: suspend (String?) -> Map<String, Any?>) {
        val activity = appContext.currentActivity
        if (activity == null || picking != null) {
            promise.resolve(SyncPayloads.connect(ConnectResult.Busy))
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        picking = { tree ->
            appContext.backgroundCoroutineScope.launch {
                runCatching { then(tree) }.fold(promise::resolve) { error -> promise.reject(SyncFailure.forScript(error)) }
            }
        }
        try {
            activity.startActivityForResult(intent, PICK_FOLDER_REQUEST)
        } catch (missing: ActivityNotFoundException) {
            picking = null
            promise.resolve(SyncPayloads.connect(ConnectResult.FolderUnavailable))
        }
    }

    companion object {
        private const val PICK_FOLDER_REQUEST = 47_202
        private const val AGE_REFRESH_MILLIS = 60_000L
    }
}
