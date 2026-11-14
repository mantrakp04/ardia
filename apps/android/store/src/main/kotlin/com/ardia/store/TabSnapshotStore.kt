package com.ardia.store

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class TabSnapshotStore(
    val directory: File,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    private val cache = LruCache<String, Bitmap>(CACHE_LIMIT)
    private val deletedTabIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    fun fileName(tabId: String): String = "$tabId.jpg"

    suspend fun save(image: Bitmap, tabId: String): String? {
        val name = fileName(tabId)
        if (tabId in deletedTabIds) return null
        val file = File(directory, name)
        val written = withContext(ioDispatcher) { encodeUnlessDeleted(image, file, tabId) } ?: return null
        if (tabId in deletedTabIds) return null
        cache.put(name, written)
        if (tabId in deletedTabIds) {
            cache.remove(name)
            return null
        }
        return name
    }

    private fun encodeUnlessDeleted(image: Bitmap, file: File, tabId: String): Bitmap? {
        if (tabId in deletedTabIds) return null
        val written = encode(image, file, directory) ?: return null
        if (tabId in deletedTabIds) {
            file.delete()
            return null
        }
        return written
    }

    fun keepInMemory(image: Bitmap, tabId: String): String {
        val name = "$MEMORY_PREFIX$tabId"
        cache.put(name, downscale(image, PIXEL_WIDTH))
        return name
    }

    suspend fun image(name: String): Bitmap? {
        cache.get(name)?.let { return it }
        if (name.startsWith(MEMORY_PREFIX)) return null
        val image = withContext(ioDispatcher) { BitmapFactory.decodeFile(File(directory, name).path) } ?: return null
        cache.put(name, image)
        return image
    }

    fun removeTabs(tabIds: Collection<String>) {
        deletedTabIds.addAll(tabIds)
        remove(tabIds.flatMap { listOf(fileName(it), "$MEMORY_PREFIX$it") })
    }

    fun remove(names: Collection<String>) {
        for (name in names) {
            cache.remove(name)
            File(directory, name).delete()
        }
    }

    companion object {
        const val POINT_WIDTH = 390.0
        const val PIXEL_WIDTH = 600
        const val JPEG_QUALITY = 72
        const val CACHE_LIMIT = 40
        private const val MEMORY_PREFIX = "memory-"

        internal fun encode(image: Bitmap, file: File, directory: File): Bitmap? {
            val scaled = downscale(image, PIXEL_WIDTH)
            directory.mkdirs()
            val temporary = File(directory, ".${UUID.randomUUID()}.jpg")
            val ok = runCatching { temporary.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) } }.getOrDefault(false)
            if (!ok || !temporary.renameTo(file)) {
                temporary.delete()
                return null
            }
            return scaled
        }

        internal fun downscale(image: Bitmap, width: Int): Bitmap {
            if (image.width <= width) return image
            val height = (image.height.toDouble() * width / image.width).roundToInt().coerceAtLeast(1)
            return Bitmap.createScaledBitmap(image, width, height, true)
        }
    }
}
