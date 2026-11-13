package com.ardia.sync.core

class SyncVault(val storage: SyncStorage, val keys: SyncKeys) {
    data class File(val id: String, val payload: ByteArray)

    data class Damaged(val id: String, val ageMillis: Long)

    class Listing {
        val files = ArrayList<File>()
        val pending = ArrayList<String>()
        val damaged = ArrayList<Damaged>()
        val present = ArrayList<String>()
    }

    class RemoveFailed(val ids: List<String>, val first: Exception) : Exception(first.message, first)

    val chain: String get() = keys.chainTag

    private fun scopePath(scope: String) = listOf(chain, keys.scopeTag(scope))

    fun chainExists(): Boolean = storage.isDirectory(listOf(chain))

    fun createChain() = storage.makeDirectory(listOf(chain))

    fun deleteChain() {
        if (chainExists()) storage.removeTree(listOf(chain))
    }

    fun write(scope: String, payload: ByteArray): String {
        val id = SyncKeys.newFileId()
        val sealed = keys.seal(payload, keys.scopeTag(scope), id)
        val directory = scopePath(scope)
        storage.makeDirectory(directory)
        storage.write(directory + "$id.$EXTENSION", sealed)
        return id
    }

    fun remove(scope: String, ids: List<String>) {
        val directory = scopePath(scope)
        val failed = ArrayList<String>()
        var first: Exception? = null
        for (id in ids) {
            try {
                storage.remove(directory + "$id.$EXTENSION")
            } catch (error: Exception) {
                failed += id
                if (first == null) first = error
            }
            try {
                storage.remove(directory + ".$id.$EXTENSION.icloud")
            } catch (error: Exception) {
            }
        }
        first?.let { throw RemoveFailed(failed, it) }
    }

    fun read(scope: String, known: Set<String>): Listing {
        val listing = Listing()
        val directory = scopePath(scope)
        val names = storage.names(directory) ?: return listing
        val suffix = ".$EXTENSION"
        val placeholder = "$suffix.icloud"
        val scopeTag = keys.scopeTag(scope)
        val present = HashSet<String>()
        for (name in names.sorted()) {
            if (name.startsWith(".") && name.endsWith(placeholder)) {
                val id = name.substring(1, name.length - placeholder.length)
                if (!Base32.isTag(id) || id in present) continue
                present += id
                listing.present += id
                if (id !in known) listing.pending += id
                continue
            }
            if (!name.endsWith(suffix)) continue
            val id = name.substring(0, name.length - suffix.length)
            if (!Base32.isTag(id)) continue
            if (present.add(id)) listing.present += id
            if (id in known) continue
            val path = directory + name
            try {
                listing.files += File(id, keys.open(storage.read(path), scopeTag, id))
            } catch (error: Exception) {
                listing.damaged += Damaged(id, storage.ageMillis(path) ?: 0L)
            }
        }
        return listing
    }

    companion object {
        const val EXTENSION = "nns"
    }
}
