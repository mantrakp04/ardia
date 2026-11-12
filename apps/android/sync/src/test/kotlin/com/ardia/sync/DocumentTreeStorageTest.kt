package com.ardia.sync

import com.ardia.sync.core.RecoveryPhrase
import com.ardia.sync.core.SyncKeys
import com.ardia.sync.core.SyncVault
import java.io.FileNotFoundException
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FakeDocumentTree(var clock: Long = 1_800_000_000_000L) : DocumentTree, CoordinatedStorage {
    class Node(var name: String, val directory: Boolean, var parent: String?) {
        var bytes = ByteArray(0)
        var modified = 0L
        var pending = false
    }

    val nodes = LinkedHashMap<String, Node>()
    private var next = 0
    var renames = true
    var renameSuffix = ""
    var failWrites = false
    var timeOutListings = false
    var duringWrite: ((String) -> Unit)? = null
    var keeps: (ByteArray) -> ByteArray = { it }
    var renameKeeps: (ByteArray) -> ByteArray = { it }
    var unreadableReads = 0
    var lateReads = 0
    var reads = 0
    override var timedOut = false

    override val rootId: String = "root"

    init {
        nodes[rootId] = Node("Picked", true, null)
    }

    fun add(parent: String, name: String, directory: Boolean = false, bytes: ByteArray = ByteArray(0)): String {
        val id = "doc${next++}"
        nodes[id] = Node(name, directory, parent).also {
            it.bytes = bytes
            it.modified = clock
        }
        return id
    }

    fun find(parent: String, name: String): String? = nodes.entries.firstOrNull { it.value.parent == parent && it.value.name == name }?.key

    fun path(vararg names: String): String? = names.fold(rootId as String?) { at, name -> at?.let { find(it, name) } }

    fun namesIn(parent: String): List<String> = nodes.values.filter { it.parent == parent }.map { it.name }.sorted()

    private fun node(id: String) = nodes[id] ?: throw FileNotFoundException(id)

    private fun entry(id: String): DocumentEntry {
        val node = node(id)
        return DocumentEntry(id, node.name, node.directory, node.modified.takeIf { it > 0 }, renames, node.pending)
    }

    override fun root(): DocumentEntry = entry(rootId)

    override fun children(parentId: String): List<DocumentEntry> {
        if (timeOutListings) {
            timedOut = true
            throw SyncStorageTimedOut()
        }
        node(parentId)
        return nodes.filter { it.value.parent == parentId }.keys.map(::entry)
    }

    override fun create(parentId: String, name: String, directory: Boolean): DocumentEntry {
        if (!node(parentId).directory) throw IOException("not a folder")
        var unique = name
        var copy = 1
        while (find(parentId, unique) != null) unique = "$name (${copy++})"
        return entry(add(parentId, unique, directory))
    }

    override fun rename(id: String, name: String): DocumentEntry {
        val node = node(id)
        node.name = name + renameSuffix
        node.bytes = renameKeeps(node.bytes)
        return entry(id)
    }

    override fun delete(id: String) {
        node(id)
        val doomed = ArrayList<String>()
        fun collect(at: String) {
            doomed += at
            nodes.filter { it.value.parent == at }.keys.forEach(::collect)
        }
        collect(id)
        doomed.forEach { nodes.remove(it) }
    }

    override fun read(id: String): ByteArray {
        reads++
        val node = node(id)
        if (unreadableReads > 0) {
            unreadableReads--
            throw IOException("not readable yet")
        }
        if (lateReads > 0) {
            lateReads--
            return ByteArray(0)
        }
        return node.bytes
    }

    override fun write(id: String, bytes: ByteArray) {
        val node = node(id)
        node.bytes = bytes.copyOf(bytes.size / 2)
        duringWrite?.invoke(id)
        if (failWrites) throw IOException("disk full")
        node.bytes = keeps(bytes)
        node.modified = clock
    }

    override fun resume() {
        timedOut = false
    }

    override fun cancelAll() {}
}

class DocumentTreeStorageTest {
    private val entropy = RecoveryPhrase.generateEntropy()
    private val keys = SyncKeys(entropy)

    private fun syncFolder(tree: FakeDocumentTree) = tree.add(tree.rootId, "Ardia Sync", directory = true)

    private val pauses = ArrayList<Long>()

    private fun storage(tree: FakeDocumentTree, subfolder: String? = "Ardia Sync") =
        DocumentTreeStorage(tree, subfolder, subfolder ?: "Picked", now = { tree.clock }, pause = { pauses += it })

    private fun scopeNames(tree: FakeDocumentTree) = tree.namesIn(tree.path("Ardia Sync", keys.chainTag, keys.scopeTag("app"))!!)

    private fun writeFails(vault: SyncVault): String {
        try {
            vault.write("app", "{\"batch\":7}".toByteArray())
        } catch (expected: IOException) {
            return expected.message ?: ""
        }
        fail("the write should fail")
        return ""
    }

    @Test
    fun aWriteTheFolderLostOrCutShortFailsAndLeavesNothingBehind() {
        val damage = mapOf<String, (ByteArray) -> ByteArray>("lost" to { ByteArray(0) }, "truncated" to { it.copyOf(it.size / 2) }, "changed" to { it.copyOf().also { b -> b[0] = (b[0] + 1).toByte() } })
        for (renames in listOf(true, false)) {
            for ((name, keep) in damage) {
                val tree = FakeDocumentTree()
                tree.renames = renames
                syncFolder(tree)
                val vault = SyncVault(storage(tree), keys)
                vault.createChain()
                tree.keeps = keep
                writeFails(vault)
                assertEquals("$name, renames $renames", emptyList<String>(), scopeNames(tree))
                tree.keeps = { it }
                val id = vault.write("app", "{\"batch\":7}".toByteArray())
                assertEquals(listOf("$id.nns"), scopeNames(tree))
                assertEquals("{\"batch\":7}", String(SyncVault(storage(tree), keys).read("app", emptySet()).files.single().payload))
            }
        }
    }

    @Test
    fun aRenameThatDamagesTheFileFailsAndRemovesItFromItsRealName() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val vault = SyncVault(storage(tree), keys)
        vault.createChain()
        tree.renameKeeps = { it.copyOf(it.size - 1) }
        writeFails(vault)
        assertEquals(emptyList<String>(), scopeNames(tree))
    }

    @Test
    fun aFileThatCantBeReadBackFailsTheWrite() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val vault = SyncVault(storage(tree), keys)
        vault.createChain()
        tree.unreadableReads = DocumentTreeStorage.PROOF_WAITS_MS.size + 1
        writeFails(vault)
        assertEquals(emptyList<String>(), scopeNames(tree))
        assertEquals(DocumentTreeStorage.PROOF_WAITS_MS, pauses)
    }

    @Test
    fun aProviderThatCommitsAfterTheDescriptorClosesIsGivenAMomentAndThenProven() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val vault = SyncVault(storage(tree), keys)
        vault.createChain()
        tree.lateReads = 2
        tree.reads = 0
        val id = vault.write("app", "{\"late\":1}".toByteArray())
        assertEquals(listOf("$id.nns"), scopeNames(tree))
        assertEquals(DocumentTreeStorage.PROOF_WAITS_MS.take(2), pauses)
        assertEquals(4, tree.reads)
    }

    @Test
    fun aPickedParentFindsTheSyncFolderAndPrefersTheOneHoldingChains() {
        val tree = FakeDocumentTree()
        assertNull(DocumentTreeStorage.locate(tree))
        val ardia = syncFolder(tree)
        val old = tree.add(tree.rootId, "Netnyahoo Sync", directory = true)
        assertEquals("Ardia Sync", DocumentTreeStorage.locate(tree))
        tree.add(old, keys.chainTag, directory = true)
        assertEquals("Netnyahoo Sync", DocumentTreeStorage.locate(tree))
        tree.add(ardia, keys.chainTag, directory = true)
        assertEquals("Ardia Sync", DocumentTreeStorage.locate(tree))
        val picked = FakeDocumentTree()
        picked.add(picked.rootId, keys.chainTag, directory = true)
        picked.add(picked.rootId, "Ardia Sync", directory = true)
        assertNull(DocumentTreeStorage.locate(picked))
    }

    @Test
    fun aFileTheMacWroteOpensAndTheVaultRoundTripsThroughTheTree() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val vault = SyncVault(storage(tree), keys)
        vault.createChain()
        assertTrue(vault.chainExists())
        val id = vault.write("app", "{\"hello\":1}".toByteArray())
        val again = SyncVault(storage(tree), keys).read("app", emptySet())
        assertEquals(listOf(id), again.files.map { it.id })
        assertEquals("{\"hello\":1}", String(again.files.single().payload))
        assertTrue(again.pending.isEmpty())
        assertTrue(again.damaged.isEmpty())
        assertEquals(listOf("$id.nns"), tree.namesIn(tree.path("Ardia Sync", keys.chainTag, keys.scopeTag("app"))!!))
    }

    @Test
    fun aFileNotDownloadedYetIsPendingAndOpensOnceItArrives() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val writer = SyncVault(storage(tree), keys)
        writer.createChain()
        val id = writer.write("app", "{\"late\":true}".toByteArray())
        val scope = tree.path("Ardia Sync", keys.chainTag, keys.scopeTag("app"))!!
        tree.nodes.getValue(tree.find(scope, "$id.nns")!!).pending = true
        val reader = SyncVault(storage(tree), keys)
        val waiting = reader.read("app", emptySet())
        assertEquals(listOf(id), waiting.pending)
        assertEquals(listOf(id), waiting.present)
        assertTrue(waiting.files.isEmpty())
        assertTrue(waiting.damaged.isEmpty())
        tree.nodes.getValue(tree.find(scope, "$id.nns")!!).pending = false
        assertEquals(listOf(id), reader.read("app", emptySet()).files.map { it.id })
    }

    @Test
    fun aWriteIsNeverListedUnderItsRealNameUntilItIsWhole() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val storage = storage(tree)
        val vault = SyncVault(storage, keys)
        vault.createChain()
        val seenDuringWrite = ArrayList<List<String>>()
        tree.duringWrite = { written -> seenDuringWrite += tree.namesIn(tree.nodes.getValue(written).parent!!) }
        val id = vault.write("app", "{\"whole\":true}".toByteArray())
        assertTrue(seenDuringWrite.single().none { it == "$id.nns" })
        assertTrue(seenDuringWrite.single().single().let { DocumentTreeStorage.isStaging(it) })
        assertEquals(listOf("$id.nns"), storage.names(listOf(keys.chainTag, keys.scopeTag("app"))))
    }

    @Test
    fun aFailedWriteLeavesNothingBehind() {
        for (renames in listOf(true, false)) {
            val tree = FakeDocumentTree()
            tree.renames = renames
            syncFolder(tree)
            val vault = SyncVault(storage(tree), keys)
            vault.createChain()
            tree.failWrites = true
            try {
                vault.write("app", "{}".toByteArray())
                fail("the write should fail")
            } catch (expected: IOException) {
            }
            val scope = tree.path("Ardia Sync", keys.chainTag, keys.scopeTag("app"))!!
            assertEquals("renames $renames", emptyList<String>(), tree.namesIn(scope))
        }
    }

    @Test
    fun aProviderThatCantRenameWritesInPlace() {
        val tree = FakeDocumentTree()
        tree.renames = false
        syncFolder(tree)
        val vault = SyncVault(storage(tree), keys)
        vault.createChain()
        val id = vault.write("app", "{\"inPlace\":1}".toByteArray())
        assertEquals("{\"inPlace\":1}", String(SyncVault(storage(tree), keys).read("app", emptySet()).files.single { it.id == id }.payload))
        assertEquals(listOf("$id.nns"), tree.namesIn(tree.path("Ardia Sync", keys.chainTag, keys.scopeTag("app"))!!))
    }

    @Test
    fun aProviderThatRenamesTheFileSomethingElseFailsTheWriteAndKeepsNoCopy() {
        val tree = FakeDocumentTree()
        tree.renameSuffix = " (1)"
        syncFolder(tree)
        val vault = SyncVault(storage(tree), keys)
        vault.createChain()
        try {
            vault.write("app", "{}".toByteArray())
            fail("the write should fail")
        } catch (expected: IOException) {
        }
        assertEquals(emptyList<String>(), tree.namesIn(tree.path("Ardia Sync", keys.chainTag, keys.scopeTag("app"))!!))
    }

    @Test
    fun aStagingFileLeftByACrashIsHiddenAndRemovedOnceStale() {
        val tree = FakeDocumentTree()
        val folder = syncFolder(tree)
        val chain = tree.add(folder, keys.chainTag, directory = true)
        val scope = tree.add(chain, keys.scopeTag("app"), directory = true)
        tree.add(scope, ".${"a".repeat(26)}.nns.1234${DocumentTreeStorage.STAGING_SUFFIX}", bytes = ByteArray(10))
        tree.add(scope, ".DS_Store")
        val storage = storage(tree)
        val path = listOf(keys.chainTag, keys.scopeTag("app"))
        assertEquals(listOf(".DS_Store"), storage.names(path))
        assertEquals(2, tree.namesIn(scope).size)
        tree.clock += DocumentTreeStorage.STALE_STAGING_MS + 1
        assertEquals(listOf(".DS_Store"), storage.names(path))
        assertEquals(listOf(".DS_Store"), tree.namesIn(scope))
    }

    @Test
    fun aSyncFolderMovedAwayReadsAsMissingNotEmpty() {
        val tree = FakeDocumentTree()
        val folder = syncFolder(tree)
        tree.add(folder, keys.chainTag, directory = true)
        val storage = storage(tree)
        assertEquals(listOf(keys.chainTag), storage.names(emptyList()))
        tree.nodes.getValue(folder).parent = "elsewhere"
        assertNull(storage.names(emptyList()))
        assertFalse(storage.isDirectory(listOf(keys.chainTag)))
        tree.nodes.getValue(folder).parent = tree.rootId
        assertEquals(listOf(keys.chainTag), storage.names(emptyList()))

        val picked = FakeDocumentTree()
        picked.add(picked.rootId, keys.chainTag, directory = true)
        val direct = storage(picked, subfolder = null)
        assertEquals(listOf(keys.chainTag), direct.names(emptyList()))
        picked.nodes.remove(picked.rootId)
        assertNull(direct.names(emptyList()))
    }

    @Test
    fun aFolderDeletedAndMadeAgainUnderANewIdIsFoundAgain() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val storage = storage(tree)
        val vault = SyncVault(storage, keys)
        vault.createChain()
        vault.write("app", "{\"one\":1}".toByteArray())
        assertEquals(1, vault.read("app", emptySet()).files.size)
        tree.delete(tree.path("Ardia Sync", keys.chainTag)!!)
        val other = SyncVault(storage(tree), keys)
        other.createChain()
        val id = other.write("app", "{\"two\":2}".toByteArray())
        assertEquals(listOf(id), vault.read("app", emptySet()).files.map { it.id })
        assertTrue(storage.names(emptyList())!!.contains(keys.chainTag))
    }

    @Test
    fun removingAFileTwiceIsFineAndPlaceholdersAreNeverDeletedByName() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val storage = storage(tree)
        val vault = SyncVault(storage, keys)
        vault.createChain()
        val id = vault.write("app", "{}".toByteArray())
        vault.remove("app", listOf(id))
        vault.remove("app", listOf(id))
        assertEquals(emptyList<String>(), storage.names(listOf(keys.chainTag, keys.scopeTag("app"))))
        val path = listOf(keys.chainTag, keys.scopeTag("app"), "missing.nns")
        assertFalse(storage.remove(path))
        assertNull(storage.ageMillis(path))
    }

    @Test
    fun aListingThatTimesOutIsReportedAsATimeout() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val storage = storage(tree)
        tree.timeOutListings = true
        try {
            storage.names(emptyList())
            fail("the listing should time out")
        } catch (expected: SyncStorageTimedOut) {
        }
        assertTrue(storage.timedOut)
        storage.resume()
        assertFalse(storage.timedOut)
    }

    @Test
    fun aFileIsReadBackByteForByte() {
        val tree = FakeDocumentTree()
        syncFolder(tree)
        val storage = storage(tree)
        storage.makeDirectory(listOf("a", "b"))
        val bytes = ByteArray(5000) { (it * 7).toByte() }
        storage.write(listOf("a", "b", "x.nns"), bytes)
        assertArrayEquals(bytes, storage.read(listOf("a", "b", "x.nns")))
        assertEquals(0L, storage.ageMillis(listOf("a", "b", "x.nns")))
        try {
            storage.makeDirectory(listOf("a", "b", "x.nns"))
            fail("a file isn't a folder")
        } catch (expected: IOException) {
        }
    }
}
