package com.ardia.sync

import com.ardia.shared.ScriptEngine
import com.ardia.sync.core.SyncKeys
import com.ardia.sync.core.SyncStorage
import com.ardia.sync.core.SyncVault
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encodeToString

class SyncHost(
    val device: String,
    val files: SyncFiles,
    val keys: SyncKeys,
    storage: SyncStorage,
) {
    @Volatile
    var vault = SyncVault(storage, keys)
        private set
    var journal = SyncJournal()
    var chainSeen = false
    var timedOut = false

    val coordination: CoordinatedStorage? get() = vault.storage as? CoordinatedStorage

    fun use(storage: SyncStorage) {
        vault = SyncVault(storage, keys)
        chainSeen = false
    }

    @Serializable
    private data class Listing(val files: List<File>, val pending: List<String>, val damaged: List<Damaged>, val present: List<String>) {
        @Serializable
        data class File(val id: String, val payload: String)

        @Serializable
        data class Damaged(val id: String, val age: Double)
    }

    fun register(script: ScriptEngine) {
        script.register("chainStatus") { chainStatus() }
        script.register("read") { args -> read(args.at(0), decodeList(args.at(1))) }
        script.register("write") { args -> vault.write(args.at(0), args.at(1).toByteArray()) }
        script.register("remove") { args ->
            vault.remove(args.at(0), decodeList(args.at(1)))
            ""
        }
        script.register("persistJournal") { args -> persistJournal(args.at(0), decodeList(args.at(1))) }
        script.register("saveState") { args -> saveState(args.at(0), syncJson.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), args.at(1))) }
    }

    fun chainStatus(): String {
        val names = try {
            vault.storage.names(emptyList())
        } catch (error: Exception) {
            null
        }
        if (names == null) {
            if (coordination?.timedOut == true) timedOut = true
            return "unavailable"
        }
        if (vault.chain in names) {
            chainSeen = true
            return "ok"
        }
        return if (chainSeen || names.any { it != ".DS_Store" }) "missing" else "unavailable"
    }

    private fun read(scope: String, known: List<String>): String {
        val listing = vault.read(scope, known.toSet())
        if (coordination?.timedOut == true) {
            timedOut = true
            throw SyncStorageTimedOut()
        }
        return listingJson(listing)
    }

    private fun persistJournal(scope: String, batches: List<String>): String {
        val next = journal.adding(scope, batches)
        files.writeSealed(syncJson.encodeToString(next).toByteArray(), files.journalFile, keys, SyncFiles.JOURNAL_FILE)
        journal = next
        return "ok"
    }

    private fun saveState(state: String, seqs: Map<String, Int>): String {
        try {
            files.writeSealed(state.toByteArray(), files.stateFile, keys, SyncFiles.STATE_FILE)
        } catch (error: Exception) {
            return "failed"
        }
        files.clearFresh(device)
        val next = journal.pruned(seqs)
        if (next != journal) {
            if (next.entries.isEmpty()) {
                files.journalFile.delete()
            } else {
                runCatching { files.writeSealed(syncJson.encodeToString(next).toByteArray(), files.journalFile, keys, SyncFiles.JOURNAL_FILE) }
            }
            journal = next
        }
        return "ok"
    }

    companion object {
        fun listingJson(listing: SyncVault.Listing): String = syncJson.encodeToString(
            Listing(
                files = listing.files.map { Listing.File(it.id, String(it.payload, Charsets.UTF_8)) },
                pending = listing.pending,
                damaged = listing.damaged.map { Listing.Damaged(it.id, it.ageMillis.toDouble()) },
                present = listing.present,
            ),
        )

        fun decodeList(json: String): List<String> = syncJson.decodeFromString(ListSerializer(String.serializer()), json)

        private fun List<String>.at(index: Int): String = getOrNull(index) ?: throw IllegalArgumentException("missing argument $index")
    }
}
