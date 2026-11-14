package com.ardia.design

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URI
import java.security.MessageDigest

object FaviconCandidates {
    fun of(iconUrl: String?, pageUrl: String?): List<String> {
        val list = ArrayList<String>(2)
        if (iconUrl != null && isWeb(iconUrl)) list += iconUrl
        if (pageUrl != null && isWeb(pageUrl)) {
            val fallback = runCatching { URI(pageUrl).resolve("/favicon.ico").toString() }.getOrNull()
            if (fallback != null && fallback !in list) list += fallback
        }
        return list
    }

    private fun isWeb(url: String): Boolean {
        val scheme = runCatching { URI(url).scheme }.getOrNull()?.lowercase() ?: return false
        return scheme.startsWith("http")
    }
}

@Immutable
class FaviconEntry(val image: ImageBitmap, val tone: FaviconTone, val source: String)

class FaviconCache(private val directory: File?, private val fetcher: FaviconFetcher = HttpFaviconFetcher()) {
    private val memory = object : LinkedHashMap<String, FaviconEntry>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, FaviconEntry>?): Boolean = size > MEMORY_LIMIT
    }
    private val failures = HashSet<String>()
    private val inFlight = HashMap<String, CompletableDeferred<FaviconEntry?>>()
    private val lock = Any()

    fun cached(url: String): FaviconEntry? = synchronized(lock) { memory[url] }

    fun cachedFirst(candidates: List<String>): FaviconEntry? = candidates.firstNotNullOfOrNull(::cached)

    suspend fun entry(url: String): FaviconEntry? {
        val waiting: CompletableDeferred<FaviconEntry?>
        val owner: Boolean
        synchronized(lock) {
            memory[url]?.let { return it }
            if (url in failures) return null
            val running = inFlight[url]
            if (running != null) {
                waiting = running
                owner = false
            } else {
                waiting = CompletableDeferred()
                inFlight[url] = waiting
                owner = true
            }
        }
        if (!owner) return waiting.await()
        val entry = try {
            withContext(Dispatchers.IO) { load(url) }
        } catch (error: Throwable) {
            synchronized(lock) { inFlight.remove(url) }
            waiting.complete(null)
            throw error
        }
        synchronized(lock) {
            inFlight.remove(url)
            if (entry != null) memory[url] = entry else failures += url
        }
        waiting.complete(entry)
        return entry
    }

    suspend fun first(candidates: List<String>): FaviconEntry? {
        for (candidate in candidates) entry(candidate)?.let { return it }
        return null
    }

    private fun load(url: String): FaviconEntry? {
        val file = directory?.let { File(it, fileName(url)) }
        if (file != null && file.isFile) {
            val bitmap = BitmapFactory.decodeFile(file.absolutePath)
            if (bitmap != null) {
                file.setLastModified(System.currentTimeMillis())
                return FaviconEntry(bitmap.asImageBitmap(), FaviconTone.measure(bitmap), url)
            }
            file.delete()
        }
        val bytes = fetcher.fetch(url) ?: return null
        val bitmap = decode(bytes) ?: return null
        val tone = FaviconTone.measure(bitmap)
        if (tone == FaviconTone.Blank) return null
        if (file != null) store(bitmap, file)
        return FaviconEntry(bitmap.asImageBitmap(), tone, url)
    }

    private fun store(bitmap: Bitmap, file: File) {
        runCatching {
            file.parentFile?.mkdirs()
            val temporary = File(file.parentFile, file.name + ".part")
            temporary.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            temporary.renameTo(file)
            prune(file.parentFile)
        }
    }

    private fun prune(folder: File?) {
        val files = folder?.listFiles { candidate -> candidate.extension == "png" } ?: return
        if (files.size <= DISK_LIMIT) return
        files.sortedBy { it.lastModified() }.take(files.size - DISK_LIMIT).forEach { it.delete() }
    }

    companion object {
        const val MEMORY_LIMIT = 300
        const val DISK_LIMIT = 600
        const val PREPARED_SIDE = 96

        @Volatile
        private var shared: FaviconCache? = null

        fun shared(context: Context): FaviconCache = shared ?: synchronized(this) {
            shared ?: FaviconCache(File(context.applicationContext.cacheDir, "favicons")).also { shared = it }
        }

        fun fileName(url: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
            return digest.take(16).joinToString("") { "%02x".format(it) } + ".png"
        }

        internal fun decode(bytes: ByteArray): Bitmap? = FaviconPixels.decode(bytes, PREPARED_SIDE)
    }
}

object FaviconPlate {
    fun color(tone: FaviconTone, dark: Boolean): Color? = when {
        tone == FaviconTone.DarkOnClear && dark -> Color.White.copy(alpha = 0.92f)
        tone == FaviconTone.LightOnClear && !dark -> Color.Black.copy(alpha = 0.78f)
        else -> null
    }
}

@Composable
fun FaviconImage(iconUrl: String?, pageUrl: String?, modifier: Modifier = Modifier, size: Dp = 16.dp, bitmap: ImageBitmap? = null) {
    val shape = RoundedCornerShape(size * 0.26f)
    Box(modifier.size(size).clip(shape).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        if (bitmap != null) {
            val tone = remember(bitmap) { FaviconTone.measure(bitmap.asAndroidBitmap()) }
            FaviconContent(bitmap, tone, size)
            return@Box
        }
        val context = LocalContext.current
        val cache = remember(context) { FaviconCache.shared(context) }
        val candidates = remember(iconUrl, pageUrl) { FaviconCandidates.of(iconUrl, pageUrl) }
        var loaded by remember(candidates) { mutableStateOf(cache.cachedFirst(candidates)) }
        LaunchedEffect(candidates) {
            if (loaded == null) loaded = cache.first(candidates)
        }
        val entry = loaded
        if (entry != null) FaviconContent(entry.image, entry.tone, size) else MonogramTile(pageUrl, size)
    }
}

@Composable
private fun FaviconContent(image: ImageBitmap, tone: FaviconTone, size: Dp) {
    val plate = FaviconPlate.color(tone, LocalArdiaDarkTheme.current)
    if (plate != null) {
        Box(Modifier.fillMaxSize().background(plate, RoundedCornerShape(size * 0.26f)))
        Image(image, null, Modifier.fillMaxSize().padding(size * 0.14f), contentScale = ContentScale.Fit, filterQuality = FilterQuality.High)
    } else {
        Image(image, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit, filterQuality = FilterQuality.High)
    }
}

@Composable
fun MonogramTile(pageUrl: String?, size: Dp, modifier: Modifier = Modifier) {
    val host = remember(pageUrl) { Monogram.host(pageUrl) }
    val letter = remember(host) { Monogram.letter(host) }
    val tint = remember(host) { ardiaColor(Monogram.tintHex(host)) }
    val fontSize = with(LocalDensity.current) { (size * 0.56f).toSp() }
    Box(modifier.fillMaxSize().background(tint.ardiaGradient()), contentAlignment = Alignment.Center) {
        if (letter != null) {
            Text(letter, color = Color.White, style = TextStyle(fontSize = fontSize, lineHeight = fontSize, fontWeight = FontWeight.SemiBold))
        } else {
            Icon(ArdiaSymbols.globe, null, Modifier.size(size * 0.6f), tint = Color.White)
        }
    }
}
