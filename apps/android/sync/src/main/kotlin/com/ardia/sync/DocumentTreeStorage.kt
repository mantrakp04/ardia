package com.ardia.sync

import com.ardia.sync.core.Base32
import com.ardia.sync.core.SyncStorage
import java.io.FileNotFoundException
import java.io.IOException
import java.util.UUID

data class DocumentEntry(
    val id: String,
    val name: String,
    val isDirectory: Boolean,
    val lastModified: Long?,
    val canRename: Boolean,
    val isPending: Boolean,
)

interface DocumentTree {
    val rootId: String

    fun root(): DocumentEntry

    fun children(parentId: String): List<DocumentEntry>

    fun create(parentId: String, name: String, directory: Boolean): DocumentEntry

    fun rename(id: String, name: String): DocumentEntry

    fun delete(id: String)

    fun read(id: String): ByteArray

    fun write(id: String, bytes: ByteArray)
}

class DocumentTreeStorage(
    val tree: DocumentTree,
    val subfolder: String?,
    override val name: String,
    private val now: () -> Long = System::currentTimeMillis,
) : SyncStorage, CoordinatedStorage {
    private val coordination = tree as? CoordinatedStorage
    private val directories = HashMap<List<String>, String>()
    private val listings = HashMap<List<String>, Map<String, DocumentEntry>>()

    override val timedOut: Boolean get() = coordination?.timedOut ?: false

    override fun resume() {
        coordination?.resume()
    }

    override fun cancelAll() {
        coordination?.cancelAll()
    }

    @Synchronized
    override fun names(path: List<String>): List<String>? = fresh {
        if (path.isEmpty()) forget()
        val id = directoryId(path) ?: return@fresh null
        val entries = listing(path, id)
        val names = ArrayList<String>(entries.size)
        for (entry in entries.values) {
            if (isStaging(entry.name)) {
                removeIfStale(entry)
                continue
            }
            names += if (entry.isPending && !entry.isDirectory && isSealed(entry.name)) placeholder(entry.name) else entry.name
        }
        names
    }

    @Synchronized
    override fun isDirectory(path: List<String>): Boolean = fresh { directoryId(path) != null }

    @Synchronized
    override fun makeDirectory(path: List<String>): Unit = fresh {
        if (directoryId(emptyList()) == null) throw FileNotFoundException("the sync folder is gone")
        for (depth in 1..path.size) {
            val wanted = path.take(depth)
            if (directoryId(wanted) != null) continue
            val parentPath = wanted.dropLast(1)
            val parent = directoryId(parentPath) ?: throw FileNotFoundException(parentPath.lastOrNull() ?: "the sync folder")
            if (listings[parentPath]?.get(wanted.last()) != null) throw IOException("${wanted.last()} isn’t a folder")
            val made = tree.create(parent, wanted.last(), directory = true)
            listings.remove(parentPath)
            if (made.name == wanted.last() && made.isDirectory) {
                directories[wanted] = made.id
            } else {
                runCatching { tree.delete(made.id) }
                directoryId(wanted) ?: throw IOException("couldn’t make ${wanted.last()}")
            }
        }
    }

    @Synchronized
    override fun removeTree(path: List<String>): Unit = fresh {
        require(path.isNotEmpty())
        val id = directoryId(path) ?: return@fresh
        tree.delete(id)
        forget()
    }

    @Synchronized
    override fun read(path: List<String>): ByteArray = fresh {
        val entry = entry(path)?.takeIf { !it.isDirectory } ?: throw FileNotFoundException(path.last())
        if (entry.isPending) throw IOException("${entry.name} isn’t downloaded yet")
        tree.read(entry.id)
    }

    @Synchronized
    override fun write(path: List<String>, bytes: ByteArray): Unit = fresh {
        val parentPath = path.dropLast(1)
        val wanted = path.last()
        val parent = directoryId(parentPath) ?: throw FileNotFoundException(parentPath.lastOrNull() ?: "the sync folder")
        val staging = tree.create(parent, ".$wanted.${UUID.randomUUID().toString().replace("-", "").take(12)}$STAGING_SUFFIX", directory = false)
        listings.remove(parentPath)
        var placed: DocumentEntry? = null
        try {
            if (staging.canRename) {
                tree.write(staging.id, bytes)
                placed = tree.rename(staging.id, wanted)
            }
        } finally {
            if (placed == null) runCatching { tree.delete(staging.id) }
        }
        val landed = placed
        if (landed == null) {
            writeInPlace(parent, wanted, bytes)
        } else if (landed.name != wanted) {
            runCatching { tree.delete(landed.id) }
            throw IOException("the folder named the file ${landed.name}")
        }
    }

    @Synchronized
    override fun remove(path: List<String>): Boolean = try {
        fresh {
            val entry = entry(path) ?: return@fresh false
            tree.delete(entry.id)
            listings.remove(path.dropLast(1))
            true
        }
    } catch (missing: FileNotFoundException) {
        false
    }

    @Synchronized
    override fun ageMillis(path: List<String>): Long? =
        runCatching { entry(path)?.lastModified }.getOrNull()?.let { maxOf(0L, now() - it) }

    private fun writeInPlace(parent: String, wanted: String, bytes: ByteArray) {
        val direct = tree.create(parent, wanted, directory = false)
        if (direct.name != wanted) {
            runCatching { tree.delete(direct.id) }
            throw IOException("the folder named the file ${direct.name}")
        }
        var written = false
        try {
            tree.write(direct.id, bytes)
            written = true
        } finally {
            if (!written) runCatching { tree.delete(direct.id) }
        }
    }

    private fun directoryId(path: List<String>): String? {
        directories[path]?.let { return it }
        val id = when {
            path.isEmpty() && subfolder == null -> rootIfPresent()
            path.isEmpty() -> tree.children(tree.rootId).firstOrNull { it.isDirectory && it.name == subfolder }?.id
            else -> {
                val parentPath = path.dropLast(1)
                val parent = directoryId(parentPath) ?: return null
                (listings[parentPath] ?: listing(parentPath, parent))[path.last()]?.takeIf { it.isDirectory }?.id
            }
        } ?: return null
        directories[path] = id
        return id
    }

    private fun rootIfPresent(): String? = try {
        tree.rootId.takeIf { tree.root().isDirectory }
    } catch (missing: FileNotFoundException) {
        null
    }

    private fun listing(path: List<String>, id: String): Map<String, DocumentEntry> {
        val byName = LinkedHashMap<String, DocumentEntry>()
        for (entry in tree.children(id)) {
            val known = byName[entry.name]
            if (known == null || (known.isPending && !entry.isPending)) byName[entry.name] = entry
        }
        listings[path] = byName
        return byName
    }

    private fun entry(path: List<String>): DocumentEntry? {
        val parentPath = path.dropLast(1)
        listings[parentPath]?.get(path.last())?.let { return it }
        val parent = directoryId(parentPath) ?: return null
        return listing(parentPath, parent)[path.last()]
    }

    private fun removeIfStale(entry: DocumentEntry) {
        val modified = entry.lastModified ?: return
        if (now() - modified > STALE_STAGING_MS) runCatching { tree.delete(entry.id) }
    }

    private fun forget() {
        directories.clear()
        listings.clear()
    }

    private inline fun <T> fresh(block: () -> T): T = try {
        block()
    } catch (missing: FileNotFoundException) {
        forget()
        block()
    }

    companion object {
        const val STAGING_SUFFIX = ".ardia-partial"
        const val STALE_STAGING_MS = 15L * 60_000

        fun isStaging(name: String): Boolean = name.startsWith(".") && name.endsWith(STAGING_SUFFIX)

        fun isSealed(name: String): Boolean = !name.startsWith(".") && name.endsWith(".nns")

        fun placeholder(name: String): String = ".$name.icloud"

        fun locate(tree: DocumentTree): String? =
            SyncFolders.subfolder(tree.children(tree.rootId), { it.name }, { it.isDirectory }) { folder ->
                tree.children(folder.id).any { Base32.isTag(it.name) }
            }?.name
    }
}
