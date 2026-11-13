package com.ardia.sync

import java.util.concurrent.Executor

class ManualTimers(var now: Long = 1_800_000_000_000L) : SyncTimers {
    private class Task(val at: Long, val order: Long, val action: () -> Unit) {
        @Volatile
        var cancelled = false
    }

    private val tasks = ArrayList<Task>()
    private var counter = 0L

    override fun now(): Long = now

    override fun after(delayMs: Long, action: () -> Unit): SyncCancellable {
        val task = synchronized(tasks) { Task(now + delayMs, counter++, action).also { tasks += it } }
        return SyncCancellable { task.cancelled = true }
    }

    fun advance(millis: Long) {
        val end = now + millis
        while (true) {
            val next = synchronized(tasks) {
                tasks.removeAll { it.cancelled }
                tasks.filter { it.at <= end }.minWithOrNull(compareBy<Task>({ it.at }, { it.order }))?.also { tasks.remove(it) }
            } ?: break
            now = maxOf(now, next.at)
            next.action()
        }
        now = maxOf(now, end)
    }

    val waiting: Int get() = synchronized(tasks) { tasks.count { !it.cancelled } }
}

val inline = Executor { it.run() }

class RecordingScheduler : SyncBackgroundScheduler {
    val updates = ArrayList<Boolean>()
    var flushes = 0
    var flushesDone = 0

    override fun update(wanted: Boolean) {
        updates += wanted
    }

    override fun flushSoon() {
        flushes++
    }

    override fun flushDone() {
        flushesDone++
    }
}

class FakeDevice(var enabledOnStart: Boolean = true) : SyncDevice {
    val calls = ArrayList<String>()
    val threads = ArrayList<String>()
    var duringSync: () -> Unit = {}
    var connectResult: ConnectResult = ConnectResult.Connected
    var nextPhase: SyncPhase = SyncPhase.Updated
    var pendingReceived = listOf<ReceivedTab>()
    var cancelledCoordination = 0
    var startsNeedingFolder = false
    var syncedSnapshot = SyncSnapshot.empty
    private var dirty = false

    override val isDemo: Boolean get() = false
    override var phase: SyncPhase = SyncPhase.Off
    override var snapshot: SyncSnapshot = SyncSnapshot.empty
    override var pendingDownloads = 0
    override var lastSynced: Long? = null
    override var isEnabled = false
    override var isRunning = false
    override var folderName: String? = null
    override val hasUnsentChanges: Boolean get() = dirty
    override val wantsBackgroundRefresh: Boolean get() = isEnabled
    override var deviceName: String = "Android"
    override var selectedProfileId: String? = null
    override var source: LocalBrowsingSource? = null

    val syncs: Int get() = calls.count { it == "sync" }

    private fun record(call: String) {
        calls += call
        threads += Thread.currentThread().name
    }

    private fun turnOn() {
        isEnabled = true
        isRunning = true
        phase = SyncPhase.Starting
        folderName = "Ardia Sync"
    }

    override fun start() {
        record("start")
        if (startsNeedingFolder) {
            isEnabled = true
            isRunning = false
            phase = SyncPhase.NeedsFolderAccess
        } else if (enabledOnStart) {
            turnOn()
        }
    }

    override fun becameActive() = record("active")

    override fun resignedActive() = record("inactive")

    override fun syncNow() {
        record("sync")
        duringSync()
        if (!isEnabled) return
        dirty = false
        phase = nextPhase
        snapshot = syncedSnapshot
        if (nextPhase == SyncPhase.Updated) lastSynced = 1L
    }

    override fun backgroundCycle(): Boolean {
        record("background")
        if (!isRunning) start()
        if (!isEnabled) return true
        syncNow()
        return phase == SyncPhase.Updated
    }

    override fun localDidChange() {
        if (!isEnabled) return
        calls += "change"
        dirty = true
    }

    override fun cancelCoordination() {
        cancelledCoordination++
    }

    override fun connect(phrase: String, pick: SyncFolderPick): ConnectResult {
        record("connect")
        if (connectResult == ConnectResult.Connected) turnOn()
        return connectResult
    }

    override fun changeFolder(pick: SyncFolderPick): ConnectResult {
        record("changeFolder")
        if (connectResult == ConnectResult.Connected) turnOn()
        return connectResult
    }

    override fun stopSyncing() {
        record("stop")
        isEnabled = false
        isRunning = false
        phase = SyncPhase.Off
        snapshot = SyncSnapshot.empty
    }

    override fun acknowledgeReset() {
        record("acknowledgeReset")
        phase = SyncPhase.Off
    }

    override fun send(url: String, title: String, to: SyncedDevice, profileSyncId: String?, key: String, fromPrivateTab: Boolean): Boolean {
        record("send")
        return !fromPrivateTab
    }

    override fun addBookmark(url: String, title: String, profileSyncId: String?, fromPrivateTab: Boolean): Boolean {
        record("bookmark")
        return !fromPrivateTab
    }

    override fun takeReceived(): List<ReceivedTab> = pendingReceived.also { pendingReceived = emptyList() }

    override fun close() = record("close")
}
