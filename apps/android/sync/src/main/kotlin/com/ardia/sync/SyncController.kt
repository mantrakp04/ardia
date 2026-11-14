package com.ardia.sync

import android.content.Context
import java.io.File
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine

data class SyncState(
    val phase: SyncPhase = SyncPhase.Off,
    val statusText: String = "Off",
    val isEnabled: Boolean = false,
    val isDemo: Boolean = false,
    val pendingDownloads: Int = 0,
    val lastSynced: Long? = null,
    val folderName: String? = null,
    val deviceName: String = SyncMeta.DEFAULT_DEVICE_NAME,
    val selectedProfileId: String? = null,
    val isSyncing: Boolean = false,
) {
    val words: SyncStatusWords get() = SyncStatusWords(phase, statusText, isEnabled)
}

fun interface SyncCancellable {
    fun cancel()
}

interface SyncTimers {
    fun now(): Long

    fun after(delayMs: Long, action: () -> Unit): SyncCancellable
}

class SystemSyncTimers : SyncTimers {
    private val scheduler = ScheduledThreadPoolExecutor(1) { work -> Thread(work, "ardia-sync-timers").apply { isDaemon = true } }.apply {
        removeOnCancelPolicy = true
    }

    override fun now(): Long = System.currentTimeMillis()

    override fun after(delayMs: Long, action: () -> Unit): SyncCancellable {
        val scheduled = scheduler.schedule({ runCatching(action) }, delayMs, TimeUnit.MILLISECONDS)
        return SyncCancellable { scheduled.cancel(false) }
    }

    fun shutdown() {
        scheduler.shutdownNow()
    }
}

interface SyncControllerOwner {
    val syncController: SyncController
}

class SyncController(
    private val makeDevice: () -> SyncDevice,
    private val timers: SyncTimers = SystemSyncTimers(),
    private val background: SyncBackgroundScheduler = SyncBackgroundScheduler.none,
    executor: Executor? = null,
) {
    constructor(
        device: SyncDevice,
        timers: SyncTimers = SystemSyncTimers(),
        background: SyncBackgroundScheduler = SyncBackgroundScheduler.none,
        executor: Executor? = null,
    ) : this({ device }, timers, background, executor)

    private val ownedThread: ExecutorService? = if (executor == null) Executors.newSingleThreadExecutor { work -> Thread(work, THREAD_NAME).apply { isDaemon = true } } else null
    private val executor: Executor = executor ?: ownedThread!!
    private val lock = Any()
    private val cycleQueued = AtomicBoolean(false)
    private val cycleToken = AtomicLong(0)

    @Volatile
    private var closed = false

    @Volatile
    private var inForeground = false

    @Volatile
    private var ready: SyncDevice? = null
    private var made: SyncDevice? = null
    private val announced = HashSet<String>()
    private var backgroundWanted: Boolean? = null

    private var base = SyncState()
    private var cycling = false
    private var updatingShown = false
    private var loopWanted = false
    private var loopTimer: SyncCancellable? = null
    private var loopGeneration = 0L
    private var debounce: SyncCancellable? = null
    private var debounceGeneration = 0L

    private val mutableState = MutableStateFlow(SyncState())
    private val mutableSnapshot = MutableStateFlow(SyncSnapshot.empty)
    private val mutableSelectedProfile = MutableStateFlow<SyncedProfile?>(null)
    private val mutableReceivers = MutableStateFlow<List<SyncedDevice>>(emptyList())
    private val mutableIncoming = MutableStateFlow<List<ReceivedTab>>(emptyList())

    val state: StateFlow<SyncState> = mutableState.asStateFlow()
    val snapshot: StateFlow<SyncSnapshot> = mutableSnapshot.asStateFlow()
    val selectedProfile: StateFlow<SyncedProfile?> = mutableSelectedProfile.asStateFlow()
    val receivers: StateFlow<List<SyncedDevice>> = mutableReceivers.asStateFlow()
    val incoming: StateFlow<List<ReceivedTab>> = mutableIncoming.asStateFlow()

    @Volatile
    var source: LocalBrowsingSource? = null
        set(value) {
            field = value
            submit { device.source = value }
        }

    init {
        active = this
        submit { publish() }
    }

    private val device: SyncDevice
        get() = made ?: makeDevice().also { created ->
            created.source = source
            made = created
            ready = created
        }

    fun start() = submit {
        device.start()
        publish()
        updateBackground()
        requestCycle()
    }

    fun appForegrounded() {
        inForeground = true
        submit(::resumeInForeground)
    }

    private fun resumeInForeground() {
        val current = device
        current.becameActive()
        publish()
        updateBackground()
        if (inForeground && !current.isDemo && current.isEnabled && current.isRunning) {
            startLoop()
            requestCycle()
        }
    }

    fun appBackgrounded() {
        inForeground = false
        stopLoop()
        val editWaiting = cancelDebounce()
        submit {
            val current = device
            current.resignedActive()
            publish()
            updateBackground()
            if (current.isDemo || !current.isEnabled || !current.isRunning || !(editWaiting || current.hasUnsentChanges)) return@submit
            runCatching { background.flushSoon() }
            cycle()
            if (current.phase == SyncPhase.Updated && !current.hasUnsentChanges) runCatching { background.flushDone() }
        }
    }

    fun localDidChange() {
        val current = ready ?: return
        if (current.isDemo || !current.isEnabled) return
        current.localDidChange()
        scheduleDebounce()
    }

    suspend fun syncNow() = onSyncThread { cycle() }

    suspend fun connect(phrase: String, pick: SyncFolderPick): ConnectResult = onSyncThread { current ->
        val result = current.connect(phrase, pick)
        publish()
        updateBackground()
        if (result == ConnectResult.Connected && !current.isDemo && current.isEnabled && current.isRunning) {
            startLoop()
            requestCycle()
        }
        result
    }

    suspend fun changeFolder(pick: SyncFolderPick): ConnectResult = onSyncThread { current ->
        val result = current.changeFolder(pick)
        publish()
        if (result == ConnectResult.Connected && !current.isDemo && current.isEnabled && current.isRunning) {
            if (inForeground) startLoop()
            requestCycle()
        }
        result
    }

    suspend fun stopSyncing() {
        stopLoop()
        cancelDebounce()
        onSyncThread { current ->
            current.stopSyncing()
            announced.clear()
            mutableIncoming.value = emptyList()
            publish()
            updateBackground()
        }
    }

    suspend fun acknowledgeReset() = onSyncThread { current ->
        current.acknowledgeReset()
        publish()
        updateBackground()
    }

    suspend fun send(
        url: String,
        title: String,
        to: SyncedDevice,
        profileSyncId: String? = null,
        key: String = UUID.randomUUID().toString(),
        fromPrivateTab: Boolean = false,
    ): Boolean = onSyncThread { current ->
        val sent = current.send(url, title, to, profileSyncId, key, fromPrivateTab)
        if (sent) requestCycle()
        sent
    }

    suspend fun pinToMac(url: String, title: String, profileSyncId: String? = null, fromPrivateTab: Boolean = false): Boolean = onSyncThread { current ->
        val pinned = current.addBookmark(url, title, profileSyncId, fromPrivateTab)
        if (pinned) requestCycle()
        pinned
    }

    suspend fun backgroundCycle(): Boolean = onSyncThread(onCancel = ::cancelCoordination) { current ->
        val updated = current.backgroundCycle()
        announce(current.takeReceived())
        publish()
        updateBackground()
        updated
    }

    fun setDeviceName(name: String) = submit {
        val current = device
        val before = current.deviceName
        current.deviceName = name
        publish()
        if (current.deviceName != before && current.isEnabled && !current.isDemo) scheduleDebounce()
    }

    fun selectProfile(profileSyncId: String?) = submit {
        device.selectedProfileId = profileSyncId
        publish()
    }

    fun check(phrase: String): PhraseCheck = SyncJoin.check(phrase)

    fun receivers(profileSyncId: String?): List<SyncedDevice> =
        snapshot.value.devicesThatReceiveTabs(profileSyncId ?: state.value.selectedProfileId)

    fun clearIncoming() {
        mutableIncoming.value = emptyList()
    }

    fun cancelCoordination() {
        ready?.cancelCoordination()
    }

    fun close() {
        stopLoop()
        cancelDebounce()
        submit {
            made?.close()
            closed = true
        }
        if (active === this) active = null
        ownedThread?.shutdown()
        (timers as? SystemSyncTimers)?.shutdown()
    }

    private fun cycle() {
        cancelDebounce()
        val current = device
        if (current.isDemo || !current.isEnabled || !current.isRunning) {
            publish()
            rescheduleLoop()
            return
        }
        val token = cycleToken.incrementAndGet()
        synchronized(lock) {
            cycling = true
            emit()
        }
        val slow = timers.after(SLOW_CYCLE_MS) { showUpdating(token) }
        try {
            current.syncNow()
        } finally {
            slow.cancel()
            synchronized(lock) {
                cycling = false
                updatingShown = false
            }
        }
        announce(current.takeReceived())
        publish()
        if (current.isEnabled) rescheduleLoop() else stopLoop()
        updateBackground()
    }

    private fun requestCycle() {
        if (closed) return
        if (cycleQueued.compareAndSet(false, true)) {
            submit {
                cycleQueued.set(false)
                cycle()
            }
        }
    }

    private fun showUpdating(token: Long) {
        synchronized(lock) {
            if (!cycling || cycleToken.get() != token || base.phase != SyncPhase.Updated) return
            updatingShown = true
            emit()
        }
    }

    private fun publish() {
        val current = device
        val fresh = current.snapshot
        val selected = current.selectedProfileId
        synchronized(lock) {
            base = SyncState(
                phase = current.phase,
                statusText = SyncStatusText.of(current.phase, current.lastSynced, current.pendingDownloads, timers.now()),
                isEnabled = current.isEnabled,
                isDemo = current.isDemo,
                pendingDownloads = current.pendingDownloads,
                lastSynced = current.lastSynced,
                folderName = current.folderName,
                deviceName = current.deviceName,
                selectedProfileId = selected,
            )
            emit()
        }
        mutableSnapshot.value = fresh
        mutableSelectedProfile.value = if (fresh.profiles.isEmpty()) null else fresh.profile(selected)
        mutableReceivers.value = fresh.devicesThatReceiveTabs(selected)
    }

    private fun emit() {
        val shown = if (updatingShown && base.phase == SyncPhase.Updated) {
            base.copy(phase = SyncPhase.Updating, statusText = SyncStatusText.of(SyncPhase.Updating, base.lastSynced, base.pendingDownloads, timers.now()))
        } else {
            base
        }
        mutableState.value = shown.copy(isSyncing = cycling)
    }

    private fun announce(tabs: List<ReceivedTab>) {
        val fresh = tabs.filter { announced.add(it.key) }
        if (fresh.isNotEmpty()) mutableIncoming.value = fresh
    }

    private fun updateBackground() {
        val current = device
        val wanted = current.wantsBackgroundRefresh && !current.isDemo
        if (wanted == backgroundWanted) return
        backgroundWanted = wanted
        runCatching { background.update(wanted) }
    }

    private fun startLoop() {
        synchronized(lock) {
            loopWanted = true
            if (loopTimer == null) loopTimer = loopAfterInterval()
        }
    }

    private fun rescheduleLoop() {
        synchronized(lock) {
            if (!loopWanted) return
            loopTimer?.cancel()
            loopTimer = loopAfterInterval()
        }
    }

    private fun stopLoop() {
        synchronized(lock) {
            loopWanted = false
            loopGeneration++
            loopTimer?.cancel()
            loopTimer = null
        }
    }

    private fun loopAfterInterval(): SyncCancellable {
        val generation = ++loopGeneration
        return timers.after(CYCLE_INTERVAL_MS) {
            val mine = synchronized(lock) {
                (loopWanted && loopGeneration == generation).also { if (it) loopTimer = null }
            }
            if (mine) requestCycle()
        }
    }

    private fun scheduleDebounce() {
        synchronized(lock) {
            debounce?.cancel()
            val generation = ++debounceGeneration
            debounce = timers.after(AFTER_EDIT_MS) {
                val mine = synchronized(lock) {
                    (debounceGeneration == generation).also { if (it) debounce = null }
                }
                if (mine) requestCycle()
            }
        }
    }

    private fun cancelDebounce(): Boolean = synchronized(lock) {
        val waiting = debounce != null
        debounceGeneration++
        debounce?.cancel()
        debounce = null
        waiting
    }

    private fun submit(task: () -> Unit) {
        try {
            executor.execute { if (!closed) runCatching(task) }
        } catch (shutDown: RejectedExecutionException) {
        }
    }

    private suspend fun <T> onSyncThread(onCancel: (() -> Unit)? = null, block: (SyncDevice) -> T): T =
        suspendCancellableCoroutine { continuation ->
            if (onCancel != null) continuation.invokeOnCancellation { onCancel() }
            val task = Runnable {
                if (closed) {
                    continuation.resumeWith(Result.failure(IllegalStateException("sync is closed")))
                    return@Runnable
                }
                continuation.resumeWith(runCatching { block(device) })
            }
            try {
                executor.execute(task)
            } catch (shutDown: RejectedExecutionException) {
                continuation.resumeWith(Result.failure(IllegalStateException("sync is closed")))
            }
        }

    companion object {
        const val CYCLE_INTERVAL_MS = 15_000L
        const val AFTER_EDIT_MS = 3_000L
        const val SLOW_CYCLE_MS = 1_000L
        const val THREAD_NAME = "ardia-sync"

        @Volatile
        var active: SyncController? = null
            private set

        fun forApp(context: Context, source: LocalBrowsingSource? = null): SyncController {
            val app = context.applicationContext
            val directory = File(app.noBackupFilesDir, "Sync")
            val controller = SyncController(
                makeDevice = {
                    SyncService(directory, KeystoreKeyStore(File(directory, "Keys")), app.assets, AndroidSyncFolderAccess(app.contentResolver))
                },
                background = WorkManagerSyncScheduler(app),
            )
            if (source != null) controller.source = source
            return controller
        }

        fun demo(): SyncController = SyncController({ DemoSyncDevice() })
    }
}
