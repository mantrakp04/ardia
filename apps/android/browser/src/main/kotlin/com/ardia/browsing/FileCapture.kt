package com.ardia.browsing

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Process
import androidx.core.content.FileProvider
import com.ardia.browser.PageRequest
import java.io.File
import java.util.UUID

data class FileChooserPlan(val documentTypes: Array<String>, val offersPhoto: Boolean, val offersVideo: Boolean, val capturesDirectly: Boolean) {
    override fun equals(other: Any?): Boolean = other is FileChooserPlan && documentTypes.contentEquals(other.documentTypes) &&
        offersPhoto == other.offersPhoto && offersVideo == other.offersVideo && capturesDirectly == other.capturesDirectly

    override fun hashCode(): Int = listOf(documentTypes.toList(), offersPhoto, offersVideo, capturesDirectly).hashCode()

    companion object {
        private val extensionTypes = mapOf(
            "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "gif" to "image/gif", "webp" to "image/webp",
            "heic" to "image/heic", "pdf" to "application/pdf", "txt" to "text/plain", "csv" to "text/csv", "mp4" to "video/mp4",
            "mov" to "video/quicktime", "mp3" to "audio/mpeg", "zip" to "application/zip", "json" to "application/json",
        )

        fun of(acceptTypes: List<String>, prefersCapture: Boolean): FileChooserPlan {
            val types = acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
                .mapNotNull { type -> if (type.startsWith(".")) extensionTypes[type.drop(1)] else type.takeIf { '/' in it } }
                .distinct()
            val anything = types.isEmpty() || "*/*" in types
            val images = anything || types.any { it.startsWith("image/") }
            val videos = anything || types.any { it.startsWith("video/") }
            val documentTypes = if (anything) arrayOf("*/*") else types.toTypedArray()
            return FileChooserPlan(documentTypes, images, videos, prefersCapture && (images || videos))
        }
    }
}

enum class VisualMedia { Images, Videos, ImagesAndVideos }

object PickerChoice {
    fun visualMedia(documentTypes: Array<String>): VisualMedia? {
        if (documentTypes.isEmpty() || documentTypes.any { !it.startsWith("image/") && !it.startsWith("video/") }) return null
        val images = documentTypes.any { it.startsWith("image/") }
        val videos = documentTypes.any { it.startsWith("video/") }
        return when {
            images && videos -> VisualMedia.ImagesAndVideos
            images -> VisualMedia.Images
            else -> VisualMedia.Videos
        }
    }
}

data class PickedFile(val uri: String, val scheme: String?, val authority: String?, val isGranted: Boolean)

object PickedFileRule {
    const val CONTENT_SCHEME = "content"

    fun isOwn(authority: String, ownAuthorities: Set<String>, packageName: String): Boolean =
        ownAuthorities.any { it.equals(authority, ignoreCase = true) } ||
            authority.equals(packageName, ignoreCase = true) || authority.startsWith("$packageName.", ignoreCase = true)

    fun accepts(file: PickedFile, ownAuthorities: Set<String>, packageName: String, captureUri: String?): Boolean {
        if (!file.scheme.equals(CONTENT_SCHEME, ignoreCase = true)) return false
        val authority = file.authority?.takeIf { it.isNotEmpty() } ?: return false
        if (isOwn(authority, ownAuthorities, packageName)) return captureUri != null && file.uri == captureUri
        return file.isGranted
    }

    fun filter(files: List<PickedFile>, ownAuthorities: Set<String>, packageName: String, captureUri: String?): List<PickedFile> =
        files.filter { accepts(it, ownAuthorities, packageName, captureUri) }
}

class CaptureFileProvider : FileProvider()

object CaptureFiles {
    fun create(context: Context, extension: String): Uri {
        val folder = File(context.cacheDir, "captures").apply { mkdirs() }
        folder.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > STALE_MILLIS }?.forEach { it.delete() }
        val file = File(folder, "${UUID.randomUUID()}.$extension")
        return FileProvider.getUriForFile(context, authority(context), file)
    }

    private const val STALE_MILLIS = 24L * 60 * 60 * 1000

    fun authority(context: Context): String = "${context.packageName}.browsing.captures"
}

object PickedFiles {
    @Suppress("DEPRECATION")
    private fun ownAuthorities(context: Context): Set<String> {
        val declared = runCatching {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PROVIDERS).providers.orEmpty()
                .flatMap { it.authority?.split(';').orEmpty() }
        }.getOrDefault(emptyList())
        return (declared + CaptureFiles.authority(context)).filter { it.isNotEmpty() }.toSet()
    }

    private fun isGranted(context: Context, uri: Uri): Boolean =
        context.checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED

    fun answer(context: Context, uris: List<Uri>, captureUri: Uri?): PageRequest.Answer {
        val own = ownAuthorities(context)
        val capture = captureUri?.toString()
        val files = uris.map { uri ->
            val isOwnCapture = capture != null && uri.toString() == capture
            PickedFile(uri.toString(), uri.scheme, uri.authority, isGranted = !isOwnCapture && isGranted(context, uri))
        }
        val accepted = PickedFileRule.filter(files, own, context.packageName, capture).map { it.uri }.toHashSet()
        return PageRequest.Answer.Files(uris.filter { it.toString() in accepted })
    }
}
