package com.ardia.sync

import com.ardia.sync.core.SyncKeys
import java.io.File
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

@Serializable
data class SyncMeta(
    val deviceId: String? = null,
    val deviceName: String = DEFAULT_DEVICE_NAME,
    val folder: SyncFolderLocation? = null,
    val enabled: Boolean = false,
    val setupAt: Long? = null,
    val lastSyncedAt: Long? = null,
    val selectedProfileId: String? = null,
    val outOfSync: Boolean = false,
    val retiringDeviceId: String? = null,
    val visitsSyncedThrough: Long? = null,
    val chainSeen: Boolean = false,
) {
    companion object {
        const val DEFAULT_DEVICE_NAME = "Android"
    }
}

@Serializable
data class SyncJournal(val entries: List<Entry> = emptyList()) {
    @Serializable
    data class Entry(val scope: String, val seq: Int, val batch: String)

    @Serializable
    private data class Sequence(val seq: Int)

    @Serializable
    private data class Origin(val device: String)

    fun adding(scope: String, batches: List<String>): SyncJournal {
        val next = entries.toMutableList()
        for (batch in batches) {
            val seq = syncJson.decodeFromString<Sequence>(batch).seq
            if (next.any { it.scope == scope && it.seq == seq }) continue
            next += Entry(scope, seq, batch)
        }
        return SyncJournal(next)
    }

    fun pruned(saved: Map<String, Int>): SyncJournal = SyncJournal(entries.filterNot { it.seq <= (saved[it.scope] ?: 0) })

    fun only(device: String): SyncJournal =
        SyncJournal(entries.filter { runCatching { syncJson.decodeFromString<Origin>(it.batch).device }.getOrNull() == device })

    val scriptJson: String
        get() = entries.groupBy { it.scope }.toSortedMap().entries.joinToString(",", "{", "}") { (scope, list) ->
            syncJson.encodeToString(scope) + ":[" + list.sortedBy { it.seq }.joinToString(",") { it.batch } + "]"
        }
}

class SyncFiles(val directory: File) {
    val metaFile get() = File(directory, "sync.json")
    val stateFile get() = File(directory, "sync-state.nns")
    val journalFile get() = File(directory, "sync-journal.nns")
    val snapshotFile get() = File(directory, "sync-snapshot.nns")
    val freshFile get() = File(directory, "sync-fresh.json")

    @Serializable
    data class Fresh(val device: String, val ghosts: List<String>)

    sealed interface SealedRead {
        data object Missing : SealedRead
        class Opened(val data: ByteArray) : SealedRead
        data object Unreadable : SealedRead
        data object Failed : SealedRead
    }

    fun loadMeta(): SyncMeta = try {
        syncJson.decodeFromString<SyncMeta>(metaFile.readText())
    } catch (error: Exception) {
        SyncMeta()
    }

    fun saveMeta(meta: SyncMeta) = write(syncJson.encodeToString(meta).toByteArray(), metaFile)

    fun readSealed(file: File, keys: SyncKeys, fileId: String): ByteArray? = (read(file, keys, fileId) as? SealedRead.Opened)?.data

    fun read(file: File, keys: SyncKeys, fileId: String): SealedRead {
        if (!file.exists()) return SealedRead.Missing
        val data = try {
            file.readBytes()
        } catch (error: IOException) {
            return SealedRead.Failed
        }
        return try {
            SealedRead.Opened(keys.open(data, LOCAL_SCOPE, fileId))
        } catch (error: Exception) {
            SealedRead.Unreadable
        }
    }

    fun writeFresh(fresh: Fresh) = write(syncJson.encodeToString(fresh).toByteArray(), freshFile)

    fun readFresh(): Fresh? = try {
        syncJson.decodeFromString<Fresh>(freshFile.readText())
    } catch (error: Exception) {
        null
    }

    fun clearFresh(device: String) {
        if (readFresh()?.device == device) freshFile.delete()
    }

    fun setAside(reason: String, state: Boolean = true, journal: Boolean = true) {
        for (file in listOfNotNull(stateFile.takeIf { state }, journalFile.takeIf { journal })) {
            if (!file.exists()) continue
            val aside = File(directory, file.nameWithoutExtension + ".$reason.nns")
            aside.delete()
            file.renameTo(aside)
        }
        snapshotFile.delete()
    }

    fun writeSealed(payload: ByteArray, file: File, keys: SyncKeys, fileId: String) = write(keys.seal(payload, LOCAL_SCOPE, fileId), file)

    fun write(data: ByteArray, file: File) {
        if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) throw IOException("can't make ${directory.name}")
        val staging = File(directory, ".${file.name}.partial")
        staging.outputStream().use {
            it.write(data)
            it.fd.sync()
        }
        try {
            Files.move(staging.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (error: AtomicMoveNotSupportedException) {
            Files.move(staging.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    fun removeSyncData() {
        listOf(stateFile, journalFile, snapshotFile, freshFile).forEach { it.delete() }
    }

    companion object {
        const val STATE_FILE = "state"
        const val JOURNAL_FILE = "journal"
        const val SNAPSHOT_FILE = "snapshot"
        const val LOCAL_SCOPE = "local"
    }
}
