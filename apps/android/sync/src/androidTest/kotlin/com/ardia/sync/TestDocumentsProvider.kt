package com.ardia.sync

import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class TestDocumentsProvider : DocumentsProvider() {
    companion object {
        const val AUTHORITY = "com.ardia.sync.test.documents"
        const val ROOT = "root"
        const val PIPE_COMMIT_DELAY_MS = 100L

        @Volatile
        var base: File? = null
        val pending: MutableSet<String> = ConcurrentHashMap.newKeySet()

        @Volatile
        var hangListingsOf: String? = null

        @Volatile
        var hang = CountDownLatch(0)

        @Volatile
        var pipeWrites = false

        @Volatile
        var damage: (ByteArray) -> ByteArray = { it }
        val damageNext = AtomicInteger(0)
        val pipeCommits = AtomicInteger(0)

        val treeUri: Uri get() = DocumentsContract.buildTreeDocumentUri(AUTHORITY, ROOT)

        fun reset(folder: File) {
            base = folder
            pending.clear()
            pipeWrites = false
            damage = { it }
            damageNext.set(0)
            pipeCommits.set(0)
            hangListingsOf = null
            hang.countDown()
        }

        fun hangListings(ofNameEndingWith: String) {
            hang = CountDownLatch(1)
            hangListingsOf = ofNameEndingWith
        }

        fun release() {
            hangListingsOf = null
            hang.countDown()
        }

        private val documentColumns = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_LAST_MODIFIED,
            Document.COLUMN_FLAGS,
            Document.COLUMN_SIZE,
        )
    }

    override fun onCreate(): Boolean = true

    private fun file(id: String): File {
        val root = base ?: throw FileNotFoundException("no folder")
        if (id == ROOT) return root
        if (!id.startsWith("$ROOT/")) throw FileNotFoundException(id)
        return File(root, id.removePrefix("$ROOT/"))
    }

    private fun id(file: File): String = if (file == base) ROOT else "$ROOT/" + file.relativeTo(base!!).path

    override fun queryRoots(projection: Array<out String>?): Cursor =
        MatrixCursor(projection ?: arrayOf(Root.COLUMN_ROOT_ID, Root.COLUMN_DOCUMENT_ID, Root.COLUMN_TITLE, Root.COLUMN_FLAGS)).apply {
            newRow()
                .add(Root.COLUMN_ROOT_ID, ROOT)
                .add(Root.COLUMN_DOCUMENT_ID, ROOT)
                .add(Root.COLUMN_TITLE, "Test Drive")
                .add(Root.COLUMN_FLAGS, Root.FLAG_SUPPORTS_CREATE or Root.FLAG_SUPPORTS_IS_CHILD)
        }

    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val target = file(documentId)
        if (!target.exists()) throw FileNotFoundException(documentId)
        return MatrixCursor(projection ?: documentColumns).also { row(it, target) }
    }

    override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor {
        val stuck = hangListingsOf
        if (stuck != null && parentDocumentId.endsWith(stuck)) hang.await(10, TimeUnit.SECONDS)
        val folder = file(parentDocumentId)
        if (!folder.isDirectory) throw FileNotFoundException(parentDocumentId)
        return MatrixCursor(projection ?: documentColumns).also { cursor -> folder.listFiles()?.sortedBy { it.name }?.forEach { row(cursor, it) } }
    }

    override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor {
        val target = file(documentId)
        if (!target.isFile) throw FileNotFoundException(documentId)
        if (pipeWrites && 'w' in mode) return commitAfterEndOfFile(target)
        return ParcelFileDescriptor.open(target, ParcelFileDescriptor.parseMode(mode))
    }

    private fun commitAfterEndOfFile(target: File): ParcelFileDescriptor {
        val (readSide, writeSide) = ParcelFileDescriptor.createReliablePipe()
        Thread {
            val received = ParcelFileDescriptor.AutoCloseInputStream(readSide).use { it.readBytes() }
            Thread.sleep(PIPE_COMMIT_DELAY_MS)
            val damaged = damageNext.getAndUpdate { maxOf(0, it - 1) } > 0
            target.writeBytes(if (damaged) damage(received) else received)
            pipeCommits.incrementAndGet()
        }.start()
        return writeSide
    }

    override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
        val folder = file(parentDocumentId)
        val made = File(folder, displayName)
        if (made.exists()) throw IllegalStateException("$displayName exists")
        val created = if (mimeType == Document.MIME_TYPE_DIR) made.mkdir() else made.createNewFile()
        if (!created) throw IllegalStateException("couldn't make $displayName")
        return id(made)
    }

    override fun deleteDocument(documentId: String) {
        val target = file(documentId)
        if (!target.exists() || !target.deleteRecursively()) throw FileNotFoundException(documentId)
    }

    override fun renameDocument(documentId: String, displayName: String): String {
        val target = file(documentId)
        val renamed = File(target.parentFile, displayName)
        if (renamed.exists()) throw IllegalStateException("$displayName exists")
        if (!target.renameTo(renamed)) throw FileNotFoundException(documentId)
        return id(renamed)
    }

    override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean =
        documentId == parentDocumentId || documentId.startsWith("$parentDocumentId/")

    private fun row(cursor: MatrixCursor, target: File) {
        var flags = Document.FLAG_SUPPORTS_DELETE or Document.FLAG_SUPPORTS_RENAME
        flags = flags or if (target.isDirectory) Document.FLAG_DIR_SUPPORTS_CREATE else Document.FLAG_SUPPORTS_WRITE
        if (target.name in pending) flags = flags or Document.FLAG_PARTIAL
        cursor.newRow()
            .add(Document.COLUMN_DOCUMENT_ID, id(target))
            .add(Document.COLUMN_DISPLAY_NAME, target.name)
            .add(Document.COLUMN_MIME_TYPE, if (target.isDirectory) Document.MIME_TYPE_DIR else ResolverDocumentTree.SEALED_MIME)
            .add(Document.COLUMN_LAST_MODIFIED, target.lastModified())
            .add(Document.COLUMN_FLAGS, flags)
            .add(Document.COLUMN_SIZE, target.length())
    }
}
