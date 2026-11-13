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
    private const val UNIFORM_GRID = 32

    fun isVisible(view: View): Boolean = view.isAttachedToWindow && view.isShown && view.width > 0 && view.height > 0

    fun isDrawable(view: View): Boolean = view.isAttachedToWindow && view.width > 0 && view.height > 0

    fun pixels(bitmap: Bitmap): IntArray {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return pixels
    }

    fun drawView(view: View, region: Rect, width: Int, height: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.scale(width / region.width().toFloat(), height / region.height().toFloat())
        canvas.translate(-(region.left + view.scrollX).toFloat(), -(region.top + view.scrollY).toFloat())
        view.draw(canvas)
        return bitmap
    }

    fun windowCopyIsTrustworthy(view: View): Boolean {
        if (!isVisible(view) || !view.isHardwareAccelerated) return false
        val visible = Rect()
        if (!view.getGlobalVisibleRect(visible) || visible.width() != view.width || visible.height() != view.height) return false
        var current: View? = view
        while (current != null) {
            if (!current.matrix.isIdentity || current.alpha < 1f) return false
            current = current.parent as? View
        }
        return true
    }

    suspend fun copyWindow(view: View, region: Rect, width: Int, height: Int): Bitmap? {
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

    fun isBlank(bitmap: Bitmap, blackIsBlank: Boolean): Boolean = CaptureCheck.isBlank(sample(bitmap, PROBE_GRID), blackIsBlank)

    fun isNearlyUniform(bitmap: Bitmap): Boolean = CaptureCheck.isNearlyUniform(sample(bitmap, UNIFORM_GRID))

    private fun sample(bitmap: Bitmap, grid: Int): IntArray {
        if (bitmap.width * bitmap.height <= grid * grid) return pixels(bitmap)
        return IntArray(grid * grid) { index ->
            val x = (index % grid) * (bitmap.width - 1) / (grid - 1)
            val y = (index / grid) * (bitmap.height - 1) / (grid - 1)
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
