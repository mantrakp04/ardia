package com.ardia.sync

import android.content.res.AssetManager
import com.ardia.sync.core.RecoveryPhrase
import com.ardia.sync.core.SyncKeyStore
import com.ardia.sync.core.SyncKeys
import com.ardia.sync.core.SyncStorage
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

interface SyncDevice {
    val isDemo: Boolean
    val phase: SyncPhase
    val snapshot: SyncSnapshot
    val pendingDownloads: Int
    val lastSynced: Long?
    val isEnabled: Boolean
    val isRunning: Boolean
    val folderName: String?
    val hasUnsentChanges: Boolean
    val wantsBackgroundRefresh: Boolean
    var deviceName: String
    var selectedProfileId: String?
    var source: LocalBrowsingSource?

    fun start()

    fun becameActive()

    fun resignedActive()

    fun syncNow()

    fun backgroundCycle(): Boolean

    fun localDidChange()

    fun cancelCoordination()

    fun connect(phrase: String, pick: SyncFolderPick): ConnectResult

    fun changeFolder(pick: SyncFolderPick): ConnectResult

    fun stopSyncing()

    fun acknowledgeReset()

    fun send(url: String, title: String, to: SyncedDevice, profileSyncId: String?, key: String, fromPrivateTab: Boolean): Boolean

    fun addBookmark(url: String, title: String, profileSyncId: String?, fromPrivateTab: Boolean): Boolean

    fun takeReceived(): List<ReceivedTab>

    fun close()
}

class SyncService(
    private val directory: File,
    private val keyStore: SyncKeyStore,
    private val assets: AssetManager,
    private val folders: SyncFolderAccess = LocalFolderAccess(),
    private val now: () -> Long = System::currentTimeMillis,
) : SyncDevice {
    private val files = SyncFiles(directory)
    private var meta = files.loadMeta()

    @Volatile
    private var engine: SyncEngine? = null
    private var visitsFetchedGeneration = -1
    private val visitGeneration = AtomicInteger(0)
    private var dueVisits: Set<String> = emptySet()
    private val localDirty = AtomicBoolean(false)
    private var missingSince: Long? = null
    private var stopping = false
    private var foreground = false
    private val received = ArrayList<ReceivedTab>()

    override val isDemo: Boolean get() = false

    @Volatile
    override var source: LocalBrowsingSource? = null

    override var phase: SyncPhase = SyncPhase.Off
        private set
    override var snapshot: SyncSnapshot = SyncSnapshot.empty
        private set
    override var pendingDownloads = 0
        private set
    override var lastSynced: Long? = meta.lastSyncedAt
        private set

    @Volatile
    override var isEnabled = false
        private set
    override var folderName: String? = meta.folder?.name
        private set

    override val isRunning: Boolean get() = engine != null
    override val hasUnsentChanges: Boolean get() = localDirty.get()
    override val wantsBackgroundRefresh: Boolean get() = isEnabled || meta.retiringDeviceId != null

    override var deviceName: String
        get() = meta.deviceName
        set(value) {
            val trimmed = value.trim().ifEmpty { SyncMeta.DEFAULT_DEVICE_NAME }
            if (trimmed == meta.deviceName) return
            updateMeta { it.copy(deviceName = trimmed) }
            localDidChange()
        }

    override var selectedProfileId: String?
        get() = meta.selectedProfileId
        set(value) {
            if (value != meta.selectedProfileId) updateMeta { it.copy(selectedProfileId = value) }
        }

    val selectedProfile: SyncedProfile? get() = snapshot.profile(selectedProfileId)

    fun devicesThatReceiveTabs(profileSyncId: String? = selectedProfileId): List<SyncedDevice> = snapshot.devicesThatReceiveTabs(profileSyncId)

    val statusText: String get() = SyncStatusText.of(phase, lastSynced, pendingDownloads, now())

    @Synchronized
    override fun start() {
        if (engine != null) return
        meta = files.loadMeta()
        folderName = meta.folder?.name
        if (meta.retiringDeviceId != null) finishPendingRetire(giveUp = false)
        if (meta.outOfSync) {
            isEnabled = false
            phase = SyncPhase.Reset
            return
        }
        val deviceId = meta.deviceId
        val location = meta.folder
        if (!meta.enabled || deviceId == null || location == null) {
            isEnabled = false
            phase = SyncPhase.Off
            return
        }
        isEnabled = true
        val entropy = keyStore.load(deviceId)?.takeIf { it.size == RecoveryPhrase.ENTROPY_BYTES }
        if (entropy == null) {
            phase = SyncPhase.Locked
            return
        }
        val grant = folders.resolve(location)
        if (grant == null) {
            phase = SyncPhase.NeedsFolderAccess
            return
        }
        val made = makeEngine(deviceId, entropy, grant.storage) ?: return
        phase = SyncPhase.Starting
        made.cachedSnapshot()?.let { if (snapshot == SyncSnapshot.empty) snapshot = it }
    }

    fun check(phrase: String): PhraseCheck = SyncJoin.check(phrase)

    fun connect(phrase: String, folder: File): ConnectResult = connect(phrase, SyncFolderPick.Folder(folder))

    @Synchronized
    override fun connect(phrase: String, pick: SyncFolderPick): ConnectResult {
        if (stopping) return ConnectResult.Busy
        foreground = true
        val entropy = try {
            RecoveryPhrase.entropy(phrase)
        } catch (failure: RecoveryPhrase.Problem) {
            return ConnectResult.InvalidPhrase(SyncJoin.message(failure))
        }
        val grant = folders.open(pick) ?: return ConnectResult.FolderUnavailable
        when (SyncEngine.check(entropy, grant.storage)) {
            FolderCheck.MATCHES -> Unit
            FolderCheck.MISMATCH -> return ConnectResult.Mismatch
            FolderCheck.NO_SYNC_DATA -> return ConnectResult.NoSyncData
            FolderCheck.UNAVAILABLE -> return ConnectResult.FolderUnavailable
        }
        val previousLocation = meta.folder
        if (!folders.keep(grant.location)) return ConnectResult.FolderUnavailable
        val abandoned = finishPendingRetire(giveUp = true)
        engine?.retire()
        engine = null
        val reuse = if (phase == SyncPhase.Locked) meta.deviceId?.takeIf { opensState(entropy) } else null
        val deviceId = reuse ?: SyncKeys.newFileId()
        if (!keyStore.save(entropy, deviceId)) {
            folders.release(grant.location, keeping = previousLocation)
            return ConnectResult.KeyStoreFailed
        }
        val replaced = if (reuse == null) meta.deviceId else null
        if (reuse == null) {
            try {
                SyncEngine.prepareFresh(directory, deviceId, listOfNotNull(abandoned, replaced))
            } catch (error: Exception) {
                keyStore.delete(deviceId)
                folders.release(grant.location, keeping = previousLocation)
                return ConnectResult.KeyStoreFailed
            }
        }
        val base = if (reuse == null) meta.copy(setupAt = now(), lastSyncedAt = null, visitsSyncedThrough = null, chainSeen = false) else meta
        if (!savedMeta(base.copy(deviceId = deviceId, folder = grant.location, enabled = true, outOfSync = false))) {
            if (reuse == null) keyStore.delete(deviceId)
            folders.release(grant.location, keeping = previousLocation)
            return ConnectResult.KeyStoreFailed
        }
        if (reuse == null) {
            replaced?.let(keyStore::delete)
            lastSynced = null
            snapshot = SyncSnapshot.empty
        }
        previousLocation?.let { folders.release(it, keeping = grant.location) }
        folderName = grant.location.name
        missingSince = null
        makeEngine(deviceId, entropy, grant.storage) ?: return ConnectResult.Connected
        isEnabled = true
        phase = SyncPhase.Starting
        visitsFetchedGeneration = -1
        return ConnectResult.Connected
    }

    @Synchronized
    override fun changeFolder(pick: SyncFolderPick): ConnectResult {
        val deviceId = meta.deviceId
        val entropy = deviceId?.let(keyStore::load)
        if (!meta.enabled || meta.outOfSync || deviceId == null || entropy == null) return ConnectResult.KeyStoreFailed
        val grant = folders.open(pick) ?: return ConnectResult.FolderUnavailable
        when (SyncEngine.check(entropy, grant.storage)) {
            FolderCheck.MATCHES -> Unit
            FolderCheck.MISMATCH -> return ConnectResult.Mismatch
            FolderCheck.NO_SYNC_DATA -> return ConnectResult.NoSyncData
            FolderCheck.UNAVAILABLE -> return ConnectResult.FolderUnavailable
        }
        if (!folders.keep(grant.location)) return ConnectResult.FolderUnavailable
        val previous = meta.folder
        if (!savedMeta(meta.copy(folder = grant.location, chainSeen = false))) {
            folders.release(grant.location, keeping = previous)
            return ConnectResult.KeyStoreFailed
        }
        previous?.let { folders.release(it, keeping = grant.location) }
        folderName = grant.location.name
        missingSince = null
        val current = engine
        if (current != null) {
            try {
                current.changeStorage(grant.storage)
            } catch (error: Exception) {
                return ConnectResult.FolderUnavailable
            }
        } else if (makeEngine(deviceId, entropy, grant.storage) == null) {
            return ConnectResult.Connected
        }
        phase = SyncPhase.Starting
        return ConnectResult.Connected
    }

    @Synchronized
    override fun acknowledgeReset() {
        if (phase != SyncPhase.Reset) return
        meta.deviceId?.let(keyStore::delete)
        updateMeta { it.copy(deviceId = null, enabled = false, outOfSync = false, lastSyncedAt = null, visitsSyncedThrough = null) }
        lastSynced = null
        isEnabled = false
        phase = SyncPhase.Off
    }

    override fun localDidChange() {
        if (!isEnabled) return
        localDirty.set(true)
        visitGeneration.incrementAndGet()
    }

    @Synchronized
    override fun becameActive() {
        foreground = true
        if (meta.retiringDeviceId != null) finishPendingRetire(giveUp = false)
        if (phase == SyncPhase.Locked || (meta.enabled && !meta.outOfSync && engine == null && phase != SyncPhase.NeedsFolderAccess)) start()
    }

    @Synchronized
    override fun resignedActive() {
        foreground = false
        missingSince = null
        updateMeta { it.copy(lastSyncedAt = lastSynced) }
    }

    @Synchronized
    override fun backgroundCycle(): Boolean {
        if (engine == null) start()
        if (!isEnabled || engine == null) return true
        syncNow()
        return phase == SyncPhase.Updated
    }

    override fun cancelCoordination() {
        engine?.cancelCoordination()
    }

    @Synchronized
    override fun syncNow() {
        var again: Boolean
        do {
            again = false
            val current = engine ?: return
            if (!isEnabled) return
            val fetchedAt = now()
            val generation = visitGeneration.get()
            val local = gatherLocal(fetchedAt, generation)
            val dirty = localDirty.getAndSet(false)
            try {
                val outcome = current.cycle(local)
                if (local.visits != null && outcome.status == CycleOutcome.Status.OK) {
                    visitsFetchedGeneration = generation
                    if ((outcome.snapshot ?: snapshot).profiles.isNotEmpty()) updateMeta { it.copy(visitsSyncedThrough = fetchedAt) }
                }
                if (outcome.status == CycleOutcome.Status.OK && source != null) {
                    dueVisits = outcome.visitsDue
                    if (dueVisits.isNotEmpty() && dueVisits != local.fetchedDue) again = true
                }
                apply(outcome, current)
            } catch (error: SyncError.Retired) {
                restoreDirty(dirty)
            } catch (error: SyncError.StateUnreadable) {
                restoreDirty(dirty)
                if (startOver(current)) again = true
            } catch (error: SyncError.StateUnavailable) {
                restoreDirty(dirty)
                phase = SyncPhase.Stalled(UNAVAILABLE_MESSAGE)
            } catch (error: Exception) {
                restoreDirty(dirty)
                phase = SyncPhase.Stalled(STALLED_MESSAGE)
            }
        } while (again && isEnabled)
    }

    fun send(url: String, title: String, to: SyncedDevice, profileSyncId: String? = null, key: String = UUID.randomUUID().toString()): Boolean =
        send(url, title, to, profileSyncId, key, fromPrivateTab = false)

    @Synchronized
    override fun send(url: String, title: String, to: SyncedDevice, profileSyncId: String?, key: String, fromPrivateTab: Boolean): Boolean {
        if (fromPrivateTab) return false
        val current = engine ?: return false
        val profile = profileSyncId ?: selectedProfile?.syncId ?: return false
        if (devicesThatReceiveTabs(profile).none { it.id == to.id }) return false
        return try {
            current.send(url, title, to.id, profile, key)
            true
        } catch (error: Exception) {
            false
        }
    }

    fun addBookmark(url: String, title: String, profileSyncId: String? = null): Boolean = addBookmark(url, title, profileSyncId, fromPrivateTab = false)

    @Synchronized
    override fun addBookmark(url: String, title: String, profileSyncId: String?, fromPrivateTab: Boolean): Boolean {
        if (fromPrivateTab) return false
        val current = engine ?: return false
        val profile = profileSyncId ?: selectedProfile?.syncId ?: return false
        return try {
            current.addBookmark(url, title, profile)
            true
        } catch (error: Exception) {
            false
        }
    }

    @Synchronized
    override fun takeReceived(): List<ReceivedTab> = received.toList().also { received.clear() }

    @Synchronized
    override fun stopSyncing() {
        if (stopping) return
        stopping = true
        try {
            val deviceId = meta.deviceId
            isEnabled = false
            val local = LocalBrowsing(meta.deviceName, null, null)
            var landed = false
            val current = engine
            if (current != null) {
                engine = null
                if (phase == SyncPhase.Locked) {
                    current.forget()
                    landed = true
                } else {
                    try {
                        landed = current.stop(local)
                    } catch (error: SyncError.StateUnreadable) {
                        current.forget()
                        deviceId?.let(::retireAsGhost)
                        landed = true
                    } catch (error: Exception) {
                        current.retire()
                    }
                }
            } else if (deviceId == null || keyStore.load(deviceId) == null) {
                files.removeSyncData()
                landed = true
            }
            if (landed) {
                deviceId?.let(keyStore::delete)
                updateMeta { it.copy(enabled = false, deviceId = null, lastSyncedAt = null, outOfSync = false, visitsSyncedThrough = null) }
            } else {
                updateMeta { it.copy(retiringDeviceId = deviceId, enabled = false, deviceId = null, lastSyncedAt = null, outOfSync = false, visitsSyncedThrough = null) }
            }
            snapshot = SyncSnapshot.empty
            lastSynced = null
            missingSince = null
            pendingDownloads = 0
            received.clear()
            localDirty.set(false)
            phase = SyncPhase.Off
        } finally {
            stopping = false
        }
    }

    @Synchronized
    override fun close() {
        updateMeta { it.copy(lastSyncedAt = lastSynced) }
        engine?.retire()
        engine = null
    }

    private fun restoreDirty(dirty: Boolean) {
        if (dirty) localDirty.set(true)
    }

    private fun makeEngine(deviceId: String, entropy: ByteArray, storage: SyncStorage): SyncEngine? = try {
        SyncEngine(directory, deviceId, entropy, storage, assets, meta.chainSeen, now).also { engine = it }
    } catch (error: Exception) {
        phase = SyncPhase.Stalled(STALLED_MESSAGE)
        null
    }

    private fun apply(outcome: CycleOutcome, current: SyncEngine) {
        if (engine !== current) return
        if (outcome.chainSeen && !meta.chainSeen) updateMeta { it.copy(chainSeen = true) }
        when (outcome.status) {
            CycleOutcome.Status.UNAVAILABLE -> {
                missingSince = null
                phase = if (meta.folder?.let(folders::hasAccess) == false) SyncPhase.NeedsFolderAccess else SyncPhase.Offline
            }
            CycleOutcome.Status.MISSING -> {
                if (!foreground) {
                    missingSince = null
                    phase = SyncPhase.Offline
                    return
                }
                val seen = now()
                val since = missingSince
                if (since == null || seen - since < RESET_CONFIRMATION_MS) {
                    if (since == null) missingSince = seen
                    phase = SyncPhase.Offline
                    return
                }
                resetFromElsewhere(current)
            }
            CycleOutcome.Status.OK -> {
                missingSince = null
                outcome.snapshot?.let { fresh -> if (!fresh.sameAs(snapshot)) snapshot = fresh }
                pendingDownloads = outcome.pending
                phase = SyncPhase.Updated
                lastSynced = now()
                val local = source
                if (outcome.historyRemoved.isNotEmpty() && local != null) {
                    for (removal in outcome.historyRemoved) {
                        local.removeVisits(removal.urls, removal.profileSyncId)
                        if (removal.includesUnassigned) local.removeVisits(removal.urls, null)
                    }
                    runCatching { current.acknowledgeRemovals(outcome.historyRemoved) }
                }
                if (outcome.received.isNotEmpty() && local != null && engine === current && local.receive(outcome.received)) {
                    received += outcome.received.filter { tab -> received.none { it.key == tab.key } }
                    runCatching { current.acknowledge(outcome.received) }
                }
            }
        }
    }

    private fun startOver(broken: SyncEngine): Boolean {
        val oldId = meta.deviceId
        val entropy = oldId?.let(keyStore::load)
        val grant = meta.folder?.let(folders::resolve)
        if (engine !== broken || oldId == null || entropy == null || grant == null) {
            phase = SyncPhase.Stalled(STALLED_MESSAGE)
            return false
        }
        val deviceId = SyncKeys.newFileId()
        if (!keyStore.save(entropy, deviceId)) {
            phase = SyncPhase.Stalled(STALLED_MESSAGE)
            return false
        }
        try {
            SyncEngine.prepareFresh(directory, deviceId, listOf(oldId))
            val next = meta.copy(deviceId = deviceId, visitsSyncedThrough = null)
            files.saveMeta(next)
            meta = next
        } catch (error: Exception) {
            keyStore.delete(deviceId)
            phase = SyncPhase.Stalled(STALLED_MESSAGE)
            return false
        }
        broken.retire()
        engine = null
        keyStore.delete(oldId)
        visitsFetchedGeneration = -1
        return makeEngine(deviceId, entropy, grant.storage) != null
    }

    private fun resetFromElsewhere(current: SyncEngine) {
        updateMeta { it.copy(outOfSync = true) }
        current.setAside("reset")
        engine = null
        missingSince = null
        snapshot = SyncSnapshot.empty
        isEnabled = false
        phase = SyncPhase.Reset
    }

    private fun retireAsGhost(oldId: String) {
        val entropy = keyStore.load(oldId) ?: return
        val grant = meta.folder?.let(folders::resolve) ?: return
        val temporary = SyncKeys.newFileId()
        val ghost = try {
            SyncEngine.prepareFresh(directory, temporary, listOf(oldId))
            SyncEngine(directory, temporary, entropy, grant.storage, assets, now = now)
        } catch (error: Exception) {
            return
        }
        val local = LocalBrowsing(meta.deviceName, null, null)
        for (round in 0 until 2) {
            val status = runCatching { ghost.cycle(local, retiring = true).status }.getOrNull()
            if (status != CycleOutcome.Status.OK) break
        }
        ghost.forget()
    }

    private fun finishPendingRetire(giveUp: Boolean): String? {
        val deviceId = meta.retiringDeviceId ?: return null
        var landed = false
        val entropy = keyStore.load(deviceId)
        val grant = meta.folder?.let(folders::resolve)
        if (entropy != null && grant != null) {
            val retiring = runCatching { SyncEngine(directory, deviceId, entropy, grant.storage, assets, now = now) }.getOrNull()
            if (retiring != null) {
                try {
                    landed = retiring.stop(LocalBrowsing(meta.deviceName, null, null))
                } catch (error: SyncError.StateUnreadable) {
                    retiring.forget()
                    retireAsGhost(deviceId)
                    landed = true
                } catch (error: Exception) {
                    retiring.retire()
                }
            }
        } else {
            landed = entropy == null
        }
        if (!(landed || giveUp) || meta.retiringDeviceId != deviceId) return null
        keyStore.delete(deviceId)
        files.removeSyncData()
        updateMeta { it.copy(retiringDeviceId = null) }
        return if (landed) null else deviceId
    }

    private fun gatherLocal(time: Long, generation: Int): LocalBrowsing {
        val local = source ?: return LocalBrowsing(meta.deviceName, null, null)
        var visits: List<LocalVisitRecord>? = null
        if (visitsFetchedGeneration != generation) {
            val window = time - HISTORY_WINDOW_MS
            val since = meta.visitsSyncedThrough?.let { maxOf(window, it - VISIT_OVERLAP_MS) } ?: window
            visits = local.syncedVisits(since).filterNot { it.isPrivate }
        }
        val due = dueVisits
        if (due.isNotEmpty()) visits = visits.orEmpty() + local.syncedVisits(due).filterNot { it.isPrivate }
        return LocalBrowsing(meta.deviceName, local.syncedTabs().filterNot { it.isPrivate }, visits, due)
    }

    private fun opensState(entropy: ByteArray): Boolean = files.readSealed(files.stateFile, SyncKeys(entropy), SyncFiles.STATE_FILE) != null

    private fun savedMeta(next: SyncMeta): Boolean {
        if (runCatching { files.saveMeta(next) }.isFailure) return false
        meta = next
        return true
    }

    private fun updateMeta(change: (SyncMeta) -> SyncMeta) {
        meta = change(meta)
        runCatching { files.saveMeta(meta) }
    }

    companion object {
        const val HISTORY_WINDOW_MS = 90L * 86_400_000
        const val VISIT_OVERLAP_MS = 300_000L
        const val RESET_CONFIRMATION_MS = 60_000L
        const val RESET_MESSAGE = SyncStatusText.RESET_MESSAGE
        const val STALLED_MESSAGE = "Ardia couldn’t read or write the sync folder. It will try again."
        const val UNAVAILABLE_MESSAGE = "Ardia can’t read its sync data right now. It will try again."

        fun message(problem: RecoveryPhrase.Problem): String = SyncJoin.message(problem)
    }
}
