package com.ardia.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

enum class CameraAccess { Checking, Ready, Denied, Unsupported }

object CameraAccessCheck {
    fun hasCamera(context: Context): Boolean = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    fun isGranted(context: Context): Boolean = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    fun initial(context: Context): CameraAccess = when {
        !hasCamera(context) -> CameraAccess.Unsupported
        isGranted(context) -> CameraAccess.Ready
        else -> CameraAccess.Checking
    }

    fun appSettings(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

class QrCameraSession(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    previewView: PreviewView,
    analyzer: QrFrameAnalyzer,
    private val onUnavailable: () -> Unit = {},
) {
    private var provider: ProcessCameraProvider? = null
    private var closed = false
    private val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
    private val analysis = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
        .also { it.setAnalyzer(analyzer.executor, analyzer) }

    fun start() {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (closed) return@addListener
            val ready = runCatching { future.get() }.getOrNull()
            if (ready == null) {
                onUnavailable()
                return@addListener
            }
            provider = ready
            runCatching {
                ready.unbind(preview, analysis)
                ready.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }.onFailure { onUnavailable() }
        }, ContextCompat.getMainExecutor(context))
    }

    fun close() {
        closed = true
        analysis.clearAnalyzer()
        provider?.unbind(preview, analysis)
    }
}

class QrFrameAnalyzer(private val onPayload: (String) -> Unit) : ImageAnalysis.Analyzer {
    val executor: ExecutorService = Executors.newSingleThreadExecutor { work -> Thread(work, "ardia-sync-scanner").apply { isDaemon = true } }
    private val decoder = QrDecoder()
    private val main = Handler(Looper.getMainLooper())
    private var buffer = ByteArray(0)

    override fun analyze(image: ImageProxy) {
        try {
            val plane = image.planes.firstOrNull() ?: return
            val data = plane.buffer
            val rowStride = plane.rowStride
            val needed = rowStride * image.height
            if (buffer.size < needed) buffer = ByteArray(needed)
            val length = minOf(data.remaining(), needed)
            data.get(buffer, 0, length)
            val text = decoder.decode(buffer, image.width, image.height, rowStride) ?: return
            main.post { onPayload(text) }
        } finally {
            image.close()
        }
    }

    fun close() {
        executor.shutdown()
    }
}
