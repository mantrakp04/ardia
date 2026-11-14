package com.ardia.sync

import android.content.ContentResolver
import android.database.ContentObserver
import android.database.Cursor
import android.net.Uri
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.io.SyncFailedException
import java.util.concurrent.Callable
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class ResolverDocumentTree(
    private val resolver: ContentResolver,
    val treeUri: Uri,
    private val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
) : DocumentTree, CoordinatedStorage {
    override val rootId: String = DocumentsContract.getTreeDocumentId(treeUri)

    private val running = ConcurrentHashMap<CancellationSignal, Future<*>>()

    @Volatile
    private var cancelled = false

    @Volatile
    override var timedOut = false
        private set

    override fun resume() {
        cancelled = false
        timedOut = false
    }

    override fun cancelAll() {
        cancelled = true
        for ((signal, future) in running) {
            signal.cancel()
            future.cancel(true)
        }
    }

    override fun root(): DocumentEntry = timed { signal -> entry(document(rootId), signal) }

    override fun children(parentId: String): List<DocumentEntry> = timed { signal ->
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
        val deadline = System.currentTimeMillis() + timeoutMs
        var listed: List<DocumentEntry>? = null
        while (listed == null) listed = listOnce(uri, signal, deadline)
        listed
    }

    override fun create(parentId: String, name: String, directory: Boolean): DocumentEntry = timed { signal ->
        val mime = if (directory) Document.MIME_TYPE_DIR else SEALED_MIME
        val made = DocumentsContract.createDocument(resolver, document(parentId), mime, name) ?: throw IOException("couldn’t make $name")
        entry(made, signal)
    }

    override fun rename(id: String, name: String): DocumentEntry = timed { signal ->
        val renamed = DocumentsContract.renameDocument(resolver, document(id), name) ?: document(id)
        entry(renamed, signal)
    }

    override fun delete(id: String) {
        timed { _ -> if (!DocumentsContract.deleteDocument(resolver, document(id))) throw IOException("couldn’t remove a file") }
    }

    override fun read(id: String): ByteArray = timed { signal ->
        val descriptor = resolver.openFileDescriptor(document(id), "r", signal) ?: throw FileNotFoundException(id)
        ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }

    override fun write(id: String, bytes: ByteArray) {
        timed { signal ->
            val descriptor = resolver.openFileDescriptor(document(id), "wt", signal) ?: throw FileNotFoundException(id)
            var failure: Throwable? = null
            try {
                val stream = FileOutputStream(descriptor.fileDescriptor)
                stream.write(bytes)
                stream.flush()
                try {
                    descriptor.fileDescriptor.sync()
                } catch (unsynced: SyncFailedException) {
                    if (!isPipeOrSocket(descriptor)) throw unsynced
                }
            } catch (error: Throwable) {
                failure = error
            }
            try {
                descriptor.close()
            } catch (error: IOException) {
                failure?.addSuppressed(error) ?: run { failure = error }
            }
            failure?.let { throw it }
        }
    }

    private fun isPipeOrSocket(descriptor: ParcelFileDescriptor): Boolean = try {
        val mode = Os.fstat(descriptor.fileDescriptor).st_mode
        OsConstants.S_ISFIFO(mode) || OsConstants.S_ISSOCK(mode)
    } catch (error: ErrnoException) {
        false
    }

    fun hasPersistedAccess(): Boolean =
        resolver.persistedUriPermissions.any { it.uri == treeUri && it.isReadPermission && it.isWritePermission }

    private fun document(id: String): Uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id)

    private fun entry(uri: Uri, signal: CancellationSignal): DocumentEntry {
        val cursor = resolver.query(uri, PROJECTION, null, signal) ?: throw FileNotFoundException(uri.toString())
        return cursor.use { if (it.moveToFirst()) entry(it) else throw FileNotFoundException(uri.toString()) }
    }

    private fun entry(cursor: Cursor): DocumentEntry {
        val flags = cursor.getInt(FLAGS)
        val modified = if (cursor.isNull(MODIFIED)) null else cursor.getLong(MODIFIED).takeIf { it > 0 }
        return DocumentEntry(
            id = cursor.getString(ID),
            name = cursor.getString(NAME) ?: "",
            isDirectory = cursor.getString(MIME) == Document.MIME_TYPE_DIR,
            lastModified = modified,
            canRename = flags and Document.FLAG_SUPPORTS_RENAME != 0,
            isPending = flags and (Document.FLAG_PARTIAL or Document.FLAG_VIRTUAL_DOCUMENT) != 0,
        )
    }

    private fun listOnce(uri: Uri, signal: CancellationSignal, deadline: Long): List<DocumentEntry>? {
        val cursor = resolver.query(uri, PROJECTION, null, signal) ?: throw IOException("the folder gave no listing")
        cursor.use { listing ->
            listing.extras?.getString(DocumentsContract.EXTRA_ERROR)?.let { throw IOException(it) }
            if (listing.extras?.getBoolean(DocumentsContract.EXTRA_LOADING) == true) {
                if (System.currentTimeMillis() >= deadline) throw OperationCanceledException()
                awaitChange(listing, deadline)
                return null
            }
            val entries = ArrayList<DocumentEntry>(listing.count)
            while (listing.moveToNext()) entries += entry(listing)
            return entries
        }
    }

    private fun awaitChange(cursor: Cursor, deadline: Long) {
        val changed = CountDownLatch(1)
        val observer = object : ContentObserver(null) {
            override fun onChange(selfChange: Boolean) = changed.countDown()
        }
        cursor.registerContentObserver(observer)
        try {
            changed.await(maxOf(0L, minOf(deadline - System.currentTimeMillis(), LOADING_POLL_MS)), TimeUnit.MILLISECONDS)
        } finally {
            cursor.unregisterContentObserver(observer)
        }
    }

    private fun <T> timed(block: (CancellationSignal) -> T): T {
        if (cancelled || timedOut) {
            timedOut = true
            throw SyncStorageTimedOut()
        }
        val signal = CancellationSignal()
        val future = workers.submit(Callable { block(signal) })
        running[signal] = future
        try {
            return future.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (late: TimeoutException) {
            signal.cancel()
            future.cancel(true)
            timedOut = true
            throw SyncStorageTimedOut()
        } catch (stopped: CancellationException) {
            timedOut = true
            throw SyncStorageTimedOut()
        } catch (interrupted: InterruptedException) {
            signal.cancel()
            future.cancel(true)
            Thread.currentThread().interrupt()
            timedOut = true
            throw SyncStorageTimedOut()
        } catch (failed: ExecutionException) {
            when (val cause = failed.cause) {
                is OperationCanceledException -> {
                    timedOut = true
                    throw SyncStorageTimedOut()
                }
                is IOException -> throw cause
                is SecurityException -> throw FolderAccessLost(cause)
                is IllegalArgumentException -> throw FileNotFoundException(cause.message)
                else -> throw IOException(cause)
            }
        } finally {
            running.remove(signal)
        }
    }

    class FolderAccessLost(cause: Throwable) : IOException("Ardia can’t open the sync folder any more", cause)

    companion object {
        const val DEFAULT_TIMEOUT_MS = 20_000L
        const val LOADING_POLL_MS = 1_000L
        const val SEALED_MIME = "application/octet-stream"

        private val PROJECTION = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_LAST_MODIFIED,
            Document.COLUMN_FLAGS,
        )
        private const val ID = 0
        private const val NAME = 1
        private const val MIME = 2
        private const val MODIFIED = 3
        private const val FLAGS = 4

        private val workers = Executors.newCachedThreadPool { work -> Thread(work, "ardia-sync-folder").apply { isDaemon = true } }
    }
}
