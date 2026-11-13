package com.ardia.sync

import android.content.res.AssetManager
import com.ardia.shared.ScriptEngine
import com.ardia.shared.SharedScript
import com.ardia.sync.core.Base32
import com.ardia.sync.core.SyncKeys
import com.ardia.sync.core.SyncStorage
import java.io.File
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class LocalBrowsing(
    val deviceName: String,
    val tabs: List<LocalTabRecord>?,
    val visits: List<LocalVisitRecord>?,
    val fetchedDue: Set<String> = emptySet(),
)

data class CycleOutcome(
    val status: Status,
    val snapshot: SyncSnapshot?,
    val received: List<ReceivedTab>,
    val historyRemoved: List<HistoryRemoval>,
    val visitsDue: Set<String> = emptySet(),
    val pending: Int,
    val published: Int,
    val changed: Int,
    val chainSeen: Boolean = false,
) {
    enum class Status { OK, MISSING, UNAVAILABLE }

    companion object {
        val offline = CycleOutcome(Status.UNAVAILABLE, null, emptyList(), emptyList(), pending = 0, published = 0, changed = 0)
    }
}

enum class FolderCheck { MATCHES, MISMATCH, NO_SYNC_DATA, UNAVAILABLE }

sealed class SyncError(message: String) : Exception(message) {
    data object CouldNotSave : SyncError("couldn't save")
    data object Refused : SyncError("refused")
    data object Retired : SyncError("retired")
    data object EngineAlreadyRunning : SyncError("another engine is running for this device")
    data object StateUnavailable : SyncError("the sync state can't be read right now")
    data object StateUnreadable : SyncError("the sync state is unreadable")
}

class SyncEngine(
    directory: File,
    val deviceId: String,
    entropy: ByteArray,
    storage: SyncStorage,
    assets: AssetManager,
    chainSeen: Boolean = false,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val token = UUID.randomUUID()
    private val host: SyncHost
    private val script: ScriptEngine
    private var loaded = false
    private var retired = false

    init {
        synchronized(live) {
            if (live.containsKey(deviceId)) throw SyncError.EngineAlreadyRunning
            live[deviceId] = token
        }
        try {
            host = SyncHost(deviceId, SyncFiles(directory), SyncKeys(entropy), storage)
            host.chainSeen = chainSeen
            script = ScriptEngine(assets, listOf(SharedScript.SYNC))
            host.register(script)
        } catch (error: Throwable) {
            release(deviceId, token)
            throw error
        }
    }

    @Synchronized
    fun changeStorage(storage: SyncStorage) {
        checkLive()
        host.use(storage)
    }

    @Synchronized
    fun cachedSnapshot(): SyncSnapshot? {
        if (retired) return null
        val data = host.files.readSealed(host.files.snapshotFile, host.keys, SyncFiles.SNAPSHOT_FILE) ?: return null
        return runCatching { syncJson.decodeFromString<SyncSnapshot>(String(data, Charsets.UTF_8)) }.getOrNull()
    }

    fun cancelCoordination() {
        host.coordination?.cancelAll()
    }

    @Synchronized
    fun cycle(local: LocalBrowsing, retiring: Boolean = false): CycleOutcome {
        checkLive()
        host.coordination?.resume()
        host.timedOut = false
        load()
        val input = CycleInput(
            name = local.deviceName,
            now = now().toDouble(),
            retiring = retiring,
            tabs = local.tabs?.map { CycleInput.Tab(it.url, it.title, it.lastActive.toDouble(), it.profileSyncId) },
            visits = local.visits?.map { visit -> CycleInput.Visit(visit.url, visit.title, visit.visitedAt.map { it.toDouble() }, visit.profileSyncId) },
            fetchedDue = local.fetchedDue.sorted(),
        )
        val json = try {
            script.callAsync(SharedScript.SYNC, "runCompanionCycle", listOf(syncJson.encodeToString(input)))
        } catch (error: Exception) {
            if (host.timedOut || host.coordination?.timedOut == true) return CycleOutcome.offline
            throw error
        }
        val output = syncJson.decodeFromString<CycleOutput>(json)
        var snapshot = output.view
        if (snapshot != null) {
            snapshot = snapshot.copy(syncedAt = now())
            runCatching { host.files.writeSealed(syncJson.encodeToString(snapshot).toByteArray(), host.files.snapshotFile, host.keys, SyncFiles.SNAPSHOT_FILE) }
        }
        return CycleOutcome(
            status = when (output.status) {
                "ok" -> CycleOutcome.Status.OK
                "missing" -> CycleOutcome.Status.MISSING
                else -> CycleOutcome.Status.UNAVAILABLE
            },
            snapshot = snapshot,
            received = output.received.map { ReceivedTab(it.key, it.u, it.t, it.fromName ?: "", it.at.toLong(), it.profile, it.from) },
            historyRemoved = output.historyRemoved.map { HistoryRemoval(it.profile, it.urls.toSet(), it.unassigned) },
            visitsDue = output.visitsDue.toSet(),
            pending = output.pending,
            published = output.published,
            changed = output.changed,
            chainSeen = host.chainSeen,
        )
    }

    @Synchronized
    fun send(url: String, title: String, to: String, profileSyncId: String, key: String = UUID.randomUUID().toString()) {
        checkLive()
        load()
        mutate("companionSend", syncJson.encodeToString(SendInput(profileSyncId, key.lowercase(), url, title, to, now().toDouble())))
    }

    @Synchronized
    fun acknowledge(tabs: List<ReceivedTab>) {
        checkLive()
        if (tabs.isEmpty()) return
        load()
        mutate("companionAcknowledge", syncJson.encodeToString(AckInput(tabs.map { AckInput.Item(it.profileSyncId, it.key) })))
    }

    @Synchronized
    fun acknowledgeRemovals(removals: List<HistoryRemoval>) {
        checkLive()
        if (removals.isEmpty()) return
        load()
        mutate("companionRemovalsDone", syncJson.encodeToString(RemovalsInput(removals.mapNotNull { removal -> removal.profileSyncId?.let { RemovalsInput.Item(it, removal.urls.sorted()) } })))
    }

    @Synchronized
    fun addBookmark(url: String, title: String, profileSyncId: String): String {
        checkLive()
        load()
        val key = UUID.randomUUID().toString().lowercase()
        mutate("companionAddBookmark", syncJson.encodeToString(BookmarkInput(profileSyncId, key, url, title, now().toDouble())))
        return key
    }

    @Synchronized
    fun stop(local: LocalBrowsing): Boolean {
        checkLive()
        val outcome = cycle(local, retiring = true)
        if (outcome.status == CycleOutcome.Status.UNAVAILABLE) {
            retire()
            return false
        }
        forget()
        return true
    }

    @Synchronized
    fun forget() {
        retire()
        host.files.removeSyncData()
        host.journal = SyncJournal()
    }

    @Synchronized
    fun setAside(reason: String) {
        retire()
        host.files.setAside(reason)
    }

    @Synchronized
    fun retire() {
        if (retired) return
        retired = true
        runCatching { script.call(SharedScript.SYNC, "companionUnload") }
        script.close()
        loaded = false
        release(deviceId, token)
    }

    private fun checkLive() {
        if (retired) throw SyncError.Retired
    }

    private fun readWithRetry(file: File, fileId: String): SyncFiles.SealedRead {
        val first = host.files.read(file, host.keys, fileId)
        if (first != SyncFiles.SealedRead.Failed) return first
        Thread.sleep(200)
        return host.files.read(file, host.keys, fileId)
    }

    private fun load() {
        if (loaded) return
        val marker = host.files.readFresh()
        val fresh = marker?.device == deviceId
        var state: String? = null
        when (val read = readWithRetry(host.files.stateFile, SyncFiles.STATE_FILE)) {
            SyncFiles.SealedRead.Failed -> throw SyncError.StateUnavailable
            SyncFiles.SealedRead.Unreadable -> {
                if (!fresh) throw SyncError.StateUnreadable
                host.files.setAside("previous", journal = false)
            }
            SyncFiles.SealedRead.Missing -> if (!fresh) throw SyncError.StateUnreadable
            is SyncFiles.SealedRead.Opened -> {
                val text = String(read.data, Charsets.UTF_8)
                val owner = runCatching { syncJson.parseToJsonElement(text).jsonObject["device"]?.jsonPrimitive?.content }.getOrNull()
                when {
                    owner == deviceId -> state = text
                    fresh -> host.files.setAside("previous", journal = false)
                    else -> throw SyncError.StateUnreadable
                }
            }
        }
        when (val read = readWithRetry(host.files.journalFile, SyncFiles.JOURNAL_FILE)) {
            SyncFiles.SealedRead.Failed -> throw SyncError.StateUnavailable
            SyncFiles.SealedRead.Unreadable -> {
                if (!fresh) throw SyncError.StateUnreadable
                host.files.setAside("previous", state = false)
                host.journal = SyncJournal()
            }
            SyncFiles.SealedRead.Missing -> host.journal = SyncJournal()
            is SyncFiles.SealedRead.Opened -> {
                val journal = runCatching { syncJson.decodeFromString<SyncJournal>(String(read.data, Charsets.UTF_8)) }.getOrNull() ?: throw SyncError.StateUnreadable
                host.journal = journal.only(deviceId)
            }
        }
        val ghosts = if (fresh && state == null) marker?.ghosts.orEmpty() else emptyList()
        val argument = "{\"device\":${syncJson.encodeToString(deviceId)},\"fresh\":${state == null},\"ghosts\":${syncJson.encodeToString(ghosts)},\"state\":${state ?: "null"},\"journal\":${host.journal.scriptJson}}"
        try {
            script.call(SharedScript.SYNC, "companionLoad", listOf(argument))
        } catch (error: Exception) {
            throw SyncError.StateUnreadable
        }
        loaded = true
    }

    private fun mutate(function: String, input: String) {
        val json = script.call(SharedScript.SYNC, function, listOf(input))
        val result = runCatching { syncJson.decodeFromString<Saved>(json) }.getOrNull()
        if (result?.refused == true) throw SyncError.Refused
        if (result?.saved != true) throw SyncError.CouldNotSave
    }

    companion object {
        private val live = HashMap<String, UUID>()

        private fun release(deviceId: String, token: UUID) {
            synchronized(live) {
                if (live[deviceId] == token) live.remove(deviceId)
            }
        }

        fun prepareFresh(directory: File, deviceId: String, ghosts: List<String>) {
            SyncFiles(directory).writeFresh(SyncFiles.Fresh(deviceId, ghosts.filter { it != deviceId }))
        }

        fun check(entropy: ByteArray, storage: SyncStorage): FolderCheck {
            val names = try {
                storage.names(emptyList())
            } catch (error: Exception) {
                null
            } ?: return FolderCheck.UNAVAILABLE
            if (SyncKeys(entropy).chainTag in names) return FolderCheck.MATCHES
            return if (names.any { Base32.isTag(it) }) FolderCheck.MISMATCH else FolderCheck.NO_SYNC_DATA
        }
    }
}

@Serializable
private data class Saved(val saved: Boolean, val refused: Boolean? = null)

@Serializable
private data class CycleInput(
    val name: String,
    val now: Double,
    val retiring: Boolean,
    val tabs: List<Tab>?,
    val visits: List<Visit>?,
    val fetchedDue: List<String>,
) {
    @Serializable
    data class Tab(val u: String, val t: String, val at: Double, val p: String?)

    @Serializable
    data class Visit(val u: String, val t: String, val vt: List<Double>, val p: String?)
}

@Serializable
private data class CycleOutput(
    val status: String,
    val view: SyncSnapshot? = null,
    val received: List<Received> = emptyList(),
    val historyRemoved: List<Removal> = emptyList(),
    val visitsDue: List<String> = emptyList(),
    val published: Int = 0,
    val changed: Int = 0,
    val pending: Int = 0,
) {
    @Serializable
    data class Received(val profile: String, val key: String, val u: String, val t: String, val from: String, val fromName: String? = null, val at: Double)

    @Serializable
    data class Removal(val profile: String, val urls: List<String>, val unassigned: Boolean)
}

@Serializable
private data class SendInput(val profile: String, val key: String, val u: String, val t: String, val to: String, val at: Double)

@Serializable
private data class AckInput(val items: List<Item>) {
    @Serializable
    data class Item(val profile: String, val key: String)
}

@Serializable
private data class BookmarkInput(val profile: String, val key: String, val u: String, val t: String, val at: Double)

@Serializable
private data class RemovalsInput(val items: List<Item>) {
    @Serializable
    data class Item(val profile: String, val urls: List<String>)
}
