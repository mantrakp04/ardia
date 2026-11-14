package com.ardia.design

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

enum class FaviconTone {
    Opaque,
    DarkOnClear,
    LightOnClear,
    Mixed,
    Blank,
    ;

    companion object {
        const val SAMPLE_SIDE = 16

        fun measure(argb: IntArray): FaviconTone {
            if (argb.isEmpty()) return Mixed
            var covered = 0
            var luminance = 0.0
            for (pixel in argb) {
                val alpha = ((pixel ushr 24) and 0xFF) / 255.0
                if (alpha <= 0.5) continue
                covered += 1
                val red = ((pixel shr 16) and 0xFF) / 255.0
                val green = ((pixel shr 8) and 0xFF) / 255.0
                val blue = (pixel and 0xFF) / 255.0
                luminance += 0.2126 * red + 0.7152 * green + 0.0722 * blue
            }
            val coverage = covered.toDouble() / argb.size
            if (coverage <= 0.04) return Blank
            if (coverage > 0.9) return Opaque
            val mean = luminance / covered
            if (mean < 0.28) return DarkOnClear
            if (mean > 0.86) return LightOnClear
            return Mixed
        }

        fun measure(bitmap: Bitmap): FaviconTone {
            val sample = Bitmap.createScaledBitmap(bitmap, SAMPLE_SIDE, SAMPLE_SIDE, true)
            val pixels = IntArray(SAMPLE_SIDE * SAMPLE_SIDE)
            sample.getPixels(pixels, 0, SAMPLE_SIDE, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE)
            if (sample !== bitmap) sample.recycle()
            return measure(pixels)
        }
    }
}

fun interface FaviconFetcher {
    fun fetch(url: String): ByteArray?
}

class HttpFaviconFetcher(private val userAgent: String = DEFAULT_USER_AGENT) : FaviconFetcher {
    override fun fetch(url: String): ByteArray? {
        val connection = runCatching { URL(url).openConnection() as HttpURLConnection }.getOrNull() ?: return null
        return try {
            connection.connectTimeout = TIMEOUT_MILLIS
            connection.readTimeout = TIMEOUT_MILLIS
            connection.instanceFollowRedirects = true
            connection.useCaches = true
            connection.setRequestProperty("User-Agent", userAgent)
            connection.setRequestProperty("Accept", "image/*")
            if (connection.responseCode !in 200..299) return null
            connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    if (output.size() > MAX_BYTES) return null
                }
                output.toByteArray()
            }
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        const val TIMEOUT_MILLIS = 8_000
        const val MAX_BYTES = 1_048_576
        const val DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36"
    }
}

object FaviconPixels {
    private const val MINIMUM_SIDE = 8

    fun decode(bytes: ByteArray, preparedSide: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth < MINIMUM_SIDE || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= preparedSide && bounds.outHeight / (sample * 2) >= preparedSide) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val longest = maxOf(decoded.width, decoded.height)
        if (longest <= preparedSide) return decoded
        val scale = preparedSide.toFloat() / longest
        val scaled = Bitmap.createScaledBitmap(decoded, maxOf(1, (decoded.width * scale).toInt()), maxOf(1, (decoded.height * scale).toInt()), true)
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }
}
