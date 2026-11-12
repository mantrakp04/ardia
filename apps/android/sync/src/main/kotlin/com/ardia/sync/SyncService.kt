package com.ardia.sync

import android.content.res.AssetManager
import com.ardia.sync.core.RecoveryPhrase
import com.ardia.sync.core.SyncKeyStore
import com.ardia.sync.core.SyncKeys
import com.ardia.sync.core.SyncStorage
import java.io.File

data class PhraseCheck(val wordCount: Int, val counterText: String, val isTooLong: Boolean, val problem: String?, val isValid: Boolean)

sealed interface ConnectResult {
    data object Connected : ConnectResult
    data class InvalidPhrase(val message: String) : ConnectResult
    data object Mismatch : ConnectResult
    data object NoSyncData : ConnectResult
    data object FolderUnavailable : ConnectResult
    data object KeyStoreFailed : ConnectResult
    data object Busy : ConnectResult
}

class SyncService(
    private val directory: File,
    private val keyStore: SyncKeyStore,
    private val assets: AssetManager,
    private val openStorage: (String) -> SyncStorage? = SyncFolders::storage,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val files = SyncFiles(directory)
    private var meta = files.loadMeta()
    private var engine: SyncEngine? = null
    private var visitsDue = true
    private var dueVisits: Set<String> = emptySet()
    private var localDirty = false
    private var missingSince: Long? = null
    private var stopping = false

    var source: LocalBrowsingSource? = null
    var foreground = true

    var phase: SyncPhase = SyncPhase.Off
        private set
    var snapshot: SyncSnapshot = SyncSnapshot.empty
        private set
    var pendingDownloads = 0
        private set
    var lastSynced: Long? = meta.lastSyncedAt
        private set
    var isEnabled = false
        private set
    val folderName: String? get() = meta.folder?.let { File(it).name }

    var deviceName: String
        get() = meta.deviceName
        set(value) {
            val trimmed = value.trim()
            updateMeta { it.copy(deviceName = trimmed.ifEmpty { SyncMeta.DEFAULT_DEVICE_NAME }) }
            localDidChange()
        }

    var selectedProfileId: String?
        get() = meta.selectedProfileId
        set(value) = updateMeta { it.copy(selectedProfileId = value) }

    val selectedProfile: SyncedProfile? get() = snapshot.profile(selectedProfileId)

    @Synchronized
    fun devicesThatReceiveTabs(profileSyncId: String? = selectedProfileId): List<SyncedDevice> {
        val profile = snapshot.profile(profileSyncId) ?: return emptyList()
        return profile.sendTargets.orEmpty().mapNotNull { id -> snapshot.devices.firstOrNull { it.id == id && it.canReceiveTabs && !it.isCurrent } }
    }

    val statusText: String
        get() = when (val current = phase) {
            SyncPhase.Off -> "Off"
            SyncPhase.Starting -> "Starting up"
            SyncPhase.Updated -> "Updated just now" + waitingText()
            is SyncPhase.Stalled -> if (lastSynced == null) "Not syncing" else "Not syncing. ${current.message}"
            SyncPhase.Offline -> "Offline"
            SyncPhase.Locked -> "Enter your recovery phrase to keep syncing on this device."
            SyncPhase.Reset -> RESET_MESSAGE
        }

    private fun waitingText(): String = when {
        pendingDownloads <= 0 -> ""
        pendingDownloads == 1 -> " · Waiting for 1 file to download"
        else -> " · Waiting for $pendingDownloads files to download"
    }

    @Synchronized
    fun start() {
        if (engine != null) return
        meta = files.loadMeta()
        if (meta.retiringDeviceId != null) finishPendingRetire(giveUp = false)
        if (meta.outOfSync) {
            isEnabled = false
            phase = SyncPhase.Reset
            return
        }
        val deviceId = meta.deviceId
        val folder = meta.folder
        if (!meta.enabled || deviceId == null || folder == null) {
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
        val storage = openStorage(folder)
        if (storage == null) {
            phase = SyncPhase.Offline
            return
        }
        val made = makeEngine(deviceId, entropy, storage) ?: return
        phase = SyncPhase.Starting
        made.cachedSnapshot()?.let { if (snapshot == SyncSnapshot.empty) snapshot = it }
    }

    fun check(phrase: String): PhraseCheck {
        val count = RecoveryPhrase.tokens(phrase).size
        val tooLong = count > RecoveryPhrase.WORD_COUNT
        var problem: String? = null
        var valid = false
        if (count == RecoveryPhrase.WORD_COUNT) {
            try {
                RecoveryPhrase.entropy(phrase)
                valid = true
            } catch (failure: RecoveryPhrase.Problem) {
                problem = message(failure)
            }
        }
        return PhraseCheck(count, if (tooLong) "too many words" else "$count/${RecoveryPhrase.WORD_COUNT} words", tooLong, problem, valid)
    }

    @Synchronized
    fun connect(phrase: String, folder: File): ConnectResult {
        if (stopping) return ConnectResult.Busy
        foreground = true
        val entropy = try {
            RecoveryPhrase.entropy(phrase)
        } catch (failure: RecoveryPhrase.Problem) {
            return ConnectResult.InvalidPhrase(message(failure))
        }
        val located = SyncFolders.locate(folder) ?: return ConnectResult.FolderUnavailable
        val storage = openStorage(located.path) ?: return ConnectResult.FolderUnavailable
        when (SyncEngine.check(entropy, storage)) {
            FolderCheck.MATCHES -> Unit
            FolderCheck.MISMATCH -> return ConnectResult.Mismatch
            FolderCheck.NO_SYNC_DATA -> return ConnectResult.NoSyncData
            FolderCheck.UNAVAILABLE -> return ConnectResult.FolderUnavailable
        }
        val abandoned = finishPendingRetire(giveUp = true)
        engine?.retire()
        engine = null
        val reuse = if (phase == SyncPhase.Locked) meta.deviceId?.takeIf { opensState(entropy) } else null
        val deviceId = reuse ?: SyncKeys.newFileId()
        if (!keyStore.save(entropy, deviceId)) return ConnectResult.KeyStoreFailed
        if (reuse == null) {
            val previous = meta.deviceId
            try {
                SyncEngine.prepareFresh(directory, deviceId, listOfNotNull(abandoned, previous))
            } catch (error: Exception) {
                keyStore.delete(deviceId)
                return ConnectResult.KeyStoreFailed
            }
            previous?.let(keyStore::delete)
            meta = meta.copy(setupAt = now(), lastSyncedAt = null, visitsSyncedThrough = null, chainSeen = false)
            lastSynced = null
            snapshot = SyncSnapshot.empty
        }
        updateMeta { it.copy(deviceId = deviceId, folder = located.path, enabled = true, outOfSync = false) }
        missingSince = null
        makeEngine(deviceId, entropy, storage) ?: return ConnectResult.Connected
        isEnabled = true
        phase = SyncPhase.Starting
        visitsDue = true
        return ConnectResult.Connected
    }

    @Synchronized
    fun localDidChange() {
        if (!isEnabled) return
        localDirty = true
        visitsDue = true
    }

    @Synchronized
    fun syncNow() {
        var again: Boolean
        do {
            again = false
            val current = engine ?: return
            if (!isEnabled) return
            val fetchedAt = now()
            val local = gatherLocal(fetchedAt)
            val dirty = localDirty
            localDirty = false
            try {
                val outcome = current.cycle(local)
                if (local.visits != null && outcome.status == CycleOutcome.Status.OK) {
                    visitsDue = false
                    if ((outcome.snapshot ?: snapshot).profiles.isNotEmpty()) updateMeta { it.copy(visitsSyncedThrough = fetchedAt) }
                }
                if (outcome.status == CycleOutcome.Status.OK && source != null) {
                    dueVisits = outcome.visitsDue
                    if (dueVisits.isNotEmpty() && dueVisits != local.fetchedDue) again = true
                }
                apply(outcome, current)
            } catch (error: SyncError.Retired) {
                localDirty = localDirty || dirty
            } catch (error: SyncError.StateUnreadable) {
                localDirty = localDirty || dirty
                if (startOver(current)) again = true
            } catch (error: SyncError.StateUnavailable) {
                localDirty = localDirty || dirty
                phase = SyncPhase.Stalled(UNAVAILABLE_MESSAGE)
            } catch (error: Exception) {
                localDirty = localDirty || dirty
                phase = SyncPhase.Stalled(STALLED_MESSAGE)
            }
        } while (again && isEnabled)
    }

    @Synchronized
    fun send(url: String, title: String, to: SyncedDevice, profileSyncId: String? = null, key: String = java.util.UUID.randomUUID().toString()): Boolean {
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

    @Synchronized
    fun addBookmark(url: String, title: String, profileSyncId: String? = null): Boolean {
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
    fun stopSyncing() {
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
            phase = SyncPhase.Off
        } finally {
            stopping = false
        }
    }

    @Synchronized
    fun close() {
        updateMeta { it.copy(lastSyncedAt = lastSynced) }
        engine?.retire()
        engine = null
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
                phase = SyncPhase.Offline
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
                    runCatching { current.acknowledge(outcome.received) }
                }
            }
        }
    }

    private fun startOver(broken: SyncEngine): Boolean {
        val oldId = meta.deviceId
        val entropy = oldId?.let(keyStore::load)
        val storage = meta.folder?.let(openStorage)
        if (engine !== broken || oldId == null || entropy == null || storage == null) {
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
            updateMeta { it.copy(deviceId = deviceId, visitsSyncedThrough = null) }
        } catch (error: Exception) {
            keyStore.delete(deviceId)
            phase = SyncPhase.Stalled(STALLED_MESSAGE)
            return false
        }
        broken.retire()
        engine = null
        keyStore.delete(oldId)
        visitsDue = true
        return makeEngine(deviceId, entropy, storage) != null
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
        val storage = meta.folder?.let(openStorage) ?: return
        val temporary = SyncKeys.newFileId()
        val ghost = try {
            SyncEngine.prepareFresh(directory, temporary, listOf(oldId))
            SyncEngine(directory, temporary, entropy, storage, assets, now = now)
        } catch (error: Exception) {
            return
        }
        val local = LocalBrowsing(meta.deviceName, null, null)
        repeat(2) {
            val status = runCatching { ghost.cycle(local, retiring = true).status }.getOrNull()
            if (status != CycleOutcome.Status.OK) return@repeat
        }
        ghost.forget()
    }

    private fun finishPendingRetire(giveUp: Boolean): String? {
        val deviceId = meta.retiringDeviceId ?: return null
        var landed = false
        val entropy = keyStore.load(deviceId)
        val storage = meta.folder?.let(openStorage)
        if (entropy != null && storage != null) {
            val retiring = runCatching { SyncEngine(directory, deviceId, entropy, storage, assets, now = now) }.getOrNull()
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

    private fun gatherLocal(time: Long): LocalBrowsing {
        val local = source ?: return LocalBrowsing(meta.deviceName, null, null)
        var visits: List<LocalVisitRecord>? = null
        if (visitsDue) {
            val window = time - HISTORY_WINDOW_MS
            val since = meta.visitsSyncedThrough?.let { maxOf(window, it - VISIT_OVERLAP_MS) } ?: window
            visits = local.syncedVisits(since)
        }
        val due = dueVisits
        if (due.isNotEmpty()) visits = visits.orEmpty() + local.syncedVisits(due)
        return LocalBrowsing(meta.deviceName, local.syncedTabs(), visits, due)
    }

    private fun opensState(entropy: ByteArray): Boolean = files.readSealed(files.stateFile, SyncKeys(entropy), SyncFiles.STATE_FILE) != null

    private fun updateMeta(change: (SyncMeta) -> SyncMeta) {
        meta = change(meta)
        runCatching { files.saveMeta(meta) }
    }

    companion object {
        const val HISTORY_WINDOW_MS = 90L * 86_400_000
        const val VISIT_OVERLAP_MS = 300_000L
        const val RESET_CONFIRMATION_MS = 60_000L
        const val RESET_MESSAGE = "This device is out of sync. Sync may have been reset from another device."
        const val STALLED_MESSAGE = "Ardia couldn't read or write the sync folder. It will try again."
        const val UNAVAILABLE_MESSAGE = "Ardia can't read its sync data right now. It will try again."

        fun message(problem: RecoveryPhrase.Problem): String = when (problem) {
            is RecoveryPhrase.Problem.WordCount -> "Recovery phrase must be exactly 24 words."
            is RecoveryPhrase.Problem.UnknownWord -> "“${problem.word}” is not a valid recovery phrase word."
            RecoveryPhrase.Problem.Checksum -> "This recovery phrase is not valid. Please check for typos."
        }
    }
}
