package com.ardia.browser

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Parcel
import android.view.PixelCopy
import android.view.View
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

internal object PageCapture {
    fun isVisible(view: View): Boolean = view.isAttachedToWindow && view.isShown && view.width > 0 && view.height > 0

    suspend fun capture(view: View, region: Rect, width: Int, height: Int): Bitmap? {
        if (width <= 0 || height <= 0 || region.isEmpty) return null
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val window = view.context.findActivity()?.window
        if (window == null) {
            val canvas = Canvas(bitmap)
            canvas.scale(width / region.width().toFloat(), height / region.height().toFloat())
            canvas.translate(-region.left.toFloat(), -region.top.toFloat())
            view.draw(canvas)
            return bitmap
        }
        val location = IntArray(2)
        view.getLocationInWindow(location)
        val source = Rect(region).apply { offset(location[0], location[1]) }
        return suspendCancellableCoroutine { continuation ->
            try {
                PixelCopy.request(window, source, bitmap, { result ->
                    if (result == PixelCopy.SUCCESS) continuation.resume(bitmap) else continuation.resume(null)
                }, Handler(Looper.getMainLooper()))
            } catch (error: IllegalArgumentException) {
                continuation.resume(null)
            }
        }
    }

    suspend fun dominantColor(view: View, region: Rect): Int? {
        val bitmap = capture(view, region, ToneSampler.SAMPLE_WIDTH, ToneSampler.SAMPLE_HEIGHT) ?: return null
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        bitmap.recycle()
        return ToneSampler.dominant(pixels)
    }

    private fun Context.findActivity(): Activity? {
        var current: Context? = this
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return null
    }
}

internal object PageStateBundles {
    fun write(bundle: Bundle): ByteArray {
        val parcel = Parcel.obtain()
        try {
            parcel.writeBundle(bundle)
            return parcel.marshall()
        } finally {
            parcel.recycle()
        }
    }

    fun read(bytes: ByteArray): Bundle? {
        val parcel = Parcel.obtain()
        return try {
            parcel.unmarshall(bytes, 0, bytes.size)
            parcel.setDataPosition(0)
            parcel.readBundle(PageStateBundles::class.java.classLoader)
        } catch (error: RuntimeException) {
            null
        } finally {
            parcel.recycle()
        }
    }
}

internal object ExternalLauncher {
    fun intentFor(url: String): Intent? {
        val intent = if (BrowserUrl.scheme(url) == "intent") {
            runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME) }.getOrNull() ?: return null
        } else {
            Intent(Intent.ACTION_VIEW, Uri.parse(url))
        }
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector = null
        return intent
    }

    fun appLinkIntent(url: String): Intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        .addCategory(Intent.CATEGORY_BROWSABLE)
        .addFlags(Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER)
}
