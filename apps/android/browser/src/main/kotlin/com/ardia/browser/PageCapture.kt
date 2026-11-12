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

internal enum class CaptureRoute {
    WindowCopy,
    ViewDraw,
}

internal class Capture(val bitmap: Bitmap, val route: CaptureRoute)

internal object PageCapture {
    private const val PROBE_GRID = 12

    fun isVisible(view: View): Boolean = view.isAttachedToWindow && view.isShown && view.width > 0 && view.height > 0

    suspend fun capture(view: View, region: Rect, width: Int, height: Int, preferred: CaptureRoute, blackIsBlank: Boolean): Capture? {
        if (width <= 0 || height <= 0 || region.isEmpty) return null
        if (preferred == CaptureRoute.WindowCopy) {
            val copied = copyWindow(view, region, width, height)
            if (copied != null && !CaptureCheck.isBlank(probe(copied), blackIsBlank)) return Capture(copied, CaptureRoute.WindowCopy)
            copied?.recycle()
        }
        return Capture(drawView(view, region, width, height), CaptureRoute.ViewDraw)
    }

    fun pixels(bitmap: Bitmap): IntArray {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return pixels
    }

    private suspend fun copyWindow(view: View, region: Rect, width: Int, height: Int): Bitmap? {
        if (!view.isHardwareAccelerated) return null
        val window = view.context.findActivity()?.window ?: return null
        val location = IntArray(2)
        view.getLocationInWindow(location)
        val source = Rect(region).apply { offset(location[0], location[1]) }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val copied = suspendCancellableCoroutine { continuation ->
            try {
                PixelCopy.request(window, source, bitmap, { result -> continuation.resume(result == PixelCopy.SUCCESS) }, Handler(Looper.getMainLooper()))
            } catch (error: IllegalArgumentException) {
                continuation.resume(false)
            }
        }
        if (copied) return bitmap
        bitmap.recycle()
        return null
    }

    private fun drawView(view: View, region: Rect, width: Int, height: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.scale(width / region.width().toFloat(), height / region.height().toFloat())
        canvas.translate(-(region.left + view.scrollX).toFloat(), -(region.top + view.scrollY).toFloat())
        view.draw(canvas)
        return bitmap
    }

    private fun probe(bitmap: Bitmap): IntArray {
        if (bitmap.width * bitmap.height <= PROBE_GRID * PROBE_GRID) return pixels(bitmap)
        return IntArray(PROBE_GRID * PROBE_GRID) { index ->
            val x = (index % PROBE_GRID) * (bitmap.width - 1) / (PROBE_GRID - 1)
            val y = (index / PROBE_GRID) * (bitmap.height - 1) / (PROBE_GRID - 1)
            bitmap.getPixel(x, y)
        }
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
