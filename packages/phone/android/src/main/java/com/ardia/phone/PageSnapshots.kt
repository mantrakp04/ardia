package com.ardia.phone

import android.content.Context
import android.graphics.Bitmap
import com.ardia.browser.PageCapture
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PageSnapshots(context: Context) {
    private val app = context.applicationContext
    private val saved = File(app.filesDir, SAVED_FOLDER)
    private val private = File(app.cacheDir, PRIVATE_FOLDER)

    suspend fun write(pageId: String, bitmap: Bitmap, isPrivate: Boolean, quality: Int): Map<String, Any?>? = withContext(Dispatchers.IO) {
        val folder = if (isPrivate) private else saved
        if (!folder.isDirectory && !folder.mkdirs()) return@withContext null
        val stem = fileStem(pageId)
        val previous = older(folder, stem, keep = null).maxByOrNull { it.lastModified() }
        if (previous != null && looksBlank(bitmap)) {
            bitmap.recycle()
            return@withContext describe(previous) + ("kept" to true)
        }
        val target = File(folder, "$stem-${System.currentTimeMillis()}-${bitmap.width}x${bitmap.height}.jpg")
        val staging = File(folder, "$stem.partial")
        val written = runCatching {
            staging.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), it) }
        }.getOrDefault(false)
        val width = bitmap.width
        val height = bitmap.height
        bitmap.recycle()
        if (!written || !staging.renameTo(target)) {
            staging.delete()
            return@withContext null
        }
        older(folder, stem, keep = target).forEach(File::delete)
        mapOf("path" to target.absolutePath, "uri" to "file://${target.absolutePath}", "width" to width, "height" to height, "bytes" to target.length().toDouble())
    }

    private fun looksBlank(bitmap: Bitmap): Boolean = PageCapture.isBlank(bitmap, blackIsBlank = true) || PageCapture.isNearlyUniform(bitmap)

    private fun describe(file: File): Map<String, Any?> {
        val size = sizeIn.find(file.name)
        return mapOf(
            "path" to file.absolutePath,
            "uri" to "file://${file.absolutePath}",
            "width" to (size?.groupValues?.get(1)?.toIntOrNull() ?: 0),
            "height" to (size?.groupValues?.get(2)?.toIntOrNull() ?: 0),
            "bytes" to file.length().toDouble(),
        )
    }

    fun delete(pageId: String) {
        val stem = fileStem(pageId)
        listOf(saved, private).forEach { folder -> older(folder, stem, keep = null).forEach(File::delete) }
    }

    fun endPrivateBrowsing() {
        private.listFiles()?.forEach(File::delete)
    }

    private fun older(folder: File, stem: String, keep: File?): List<File> =
        folder.listFiles { file -> file.name.startsWith("$stem-") && file.name.endsWith(".jpg") && file != keep }?.toList().orEmpty()

    companion object {
        private const val SAVED_FOLDER = "PageSnapshots"
        private const val PRIVATE_FOLDER = "PrivatePageSnapshots"
        private val safeId = Regex("[A-Za-z0-9_]{1,64}")
        private val sizeIn = Regex("-(\\d+)x(\\d+)\\.jpg$")

        fun fileStem(pageId: String): String {
            if (safeId.matches(pageId)) return pageId
            val digest = MessageDigest.getInstance("SHA-256").digest(pageId.toByteArray(Charsets.UTF_8))
            return digest.take(16).joinToString("") { "%02x".format(it) }
        }
    }
}
