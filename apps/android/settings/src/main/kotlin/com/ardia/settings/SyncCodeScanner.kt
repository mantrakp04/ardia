package com.ardia.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.Motion
import com.ardia.design.Palette
import com.ardia.design.Radius
import com.ardia.design.Spacing
import com.ardia.design.bold
import com.ardia.design.medium
import com.ardia.design.semibold
import com.ardia.sync.SyncJoin
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

@Composable
fun SyncCodeScanner(onScan: (String) -> Unit, onEnterWords: () -> Unit, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    var access by rememberSaveable { mutableStateOf(CameraAccessCheck.initial(context)) }
    var showsRejection by remember { mutableStateOf(false) }
    val judge = remember { SyncCodeJudge() }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        access = if (granted) CameraAccess.Ready else CameraAccess.Denied
    }
    LaunchedEffect(access) {
        if (access == CameraAccess.Checking) runCatching { permission.launch(Manifest.permission.CAMERA) }.onFailure { access = CameraAccess.Denied }
    }

    Box(modifier.fillMaxSize().background(Color.Black)) {
        when (access) {
            CameraAccess.Checking -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
            CameraAccess.Ready -> {
                CameraPreview(Modifier.fillMaxSize()) { payload ->
                    when (val verdict = judge.judge(payload)) {
                        is ScanVerdict.Accept -> onScan(verdict.phrase)
                        ScanVerdict.Reject -> {
                            haptics.performHapticFeedback(HapticFeedbackType.Reject)
                            showsRejection = true
                        }
                        ScanVerdict.Repeat -> Unit
                    }
                }
                Viewfinder(showsRejection, onEnterWords)
            }
            CameraAccess.Denied -> Unavailable(
                title = stringResource(R.string.scan_allow_camera),
                message = stringResource(R.string.scan_allow_camera_message),
                showsSettings = true,
                onEnterWords = onEnterWords,
            )
            CameraAccess.Unsupported -> Unavailable(
                title = stringResource(R.string.scan_unsupported),
                message = stringResource(R.string.scan_unsupported_message),
                showsSettings = false,
                onEnterWords = onEnterWords,
            )
        }
        Box(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(Spacing.tight)) {
            Text(
                stringResource(R.string.settings_cancel),
                style = ArdiaType.body,
                color = Color.White,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .clickable(role = Role.Button, onClick = onCancel)
                    .padding(horizontal = Spacing.small, vertical = Spacing.tight)
                    .testTag(SettingsTags.row("scanCancel")),
            )
        }
    }
}

@Composable
private fun Viewfinder(showsRejection: Boolean, onEnterWords: () -> Unit) {
    Column(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(top = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.medium),
    ) {
        Column(
            Modifier.padding(horizontal = Spacing.section, vertical = Spacing.page),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.tight),
        ) {
            Text(stringResource(R.string.scan_title), style = ArdiaType.title3.bold, color = Color.White, textAlign = TextAlign.Center)
            Text(stringResource(R.string.scan_detail), style = ArdiaType.subheadline, color = Color.White.copy(alpha = 0.75f), textAlign = TextAlign.Center)
        }
        Spacer(Modifier.weight(1f))
        Canvas(Modifier.size(250.dp).clearAndSetSemantics {}) { drawViewfinderCorners(Color.White.copy(alpha = 0.9f), 3.dp.toPx(), 0.18f) }
        Spacer(Modifier.weight(1f))
        AnimatedVisibility(showsRejection, enter = fadeIn(Motion.snappy.spec()), exit = fadeOut(Motion.snappy.spec())) {
            Text(
                SyncJoin.SCAN_REJECTED,
                style = ArdiaType.subheadline.medium,
                color = Color.White,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(horizontal = Spacing.section)
                    .clip(RoundedCornerShape(Radius.field))
                    .background(Color.White.copy(alpha = 0.18f))
                    .padding(horizontal = Spacing.page, vertical = Spacing.small)
                    .testTag(SettingsTags.row("scanRejected")),
            )
        }
        GlassButton(stringResource(R.string.scan_enter_words_instead), onClick = onEnterWords, modifier = Modifier.padding(bottom = Spacing.large))
    }
}

@Composable
private fun Unavailable(title: String, message: String, showsSettings: Boolean, onEnterWords: () -> Unit) {
    val context = LocalContext.current
    Column(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = Spacing.section),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.medium, Alignment.CenterVertically),
    ) {
        Icon(if (showsSettings) ArdiaSymbols.gearshape else ArdiaSymbols.qrcodeViewfinder, null, Modifier.size(48.dp), tint = Color.White.copy(alpha = 0.85f))
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.tight)) {
            Text(title, style = ArdiaType.title3.bold, color = Color.White, textAlign = TextAlign.Center)
            Text(message, style = ArdiaType.subheadline, color = Color.White.copy(alpha = 0.75f), textAlign = TextAlign.Center)
        }
        Column(Modifier.padding(top = Spacing.tight), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            if (showsSettings) {
                GlassButton(stringResource(R.string.scan_open_settings), prominent = true, onClick = { runCatching { context.startActivity(CameraAccessCheck.appSettings(context)) } })
            }
            GlassButton(stringResource(R.string.scan_enter_words_instead), onClick = onEnterWords)
        }
    }
}

@Composable
private fun GlassButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, prominent: Boolean = false) {
    Box(
        modifier
            .heightIn(min = 50.dp)
            .clip(RoundedCornerShape(50))
            .background(if (prominent) Palette.primaryAction.resolve(true) else Color.White.copy(alpha = 0.2f))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Spacing.large, vertical = Spacing.small),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = ArdiaType.body.semibold, color = if (prominent) Palette.onPrimaryAction.resolve(true) else Color.White)
    }
}

fun DrawScope.drawViewfinderCorners(color: Color, strokeWidth: Float, armShare: Float = 0.28f) {
    val arm = size.width * armShare
    val path = Path()
    val corners = listOf(
        Triple(Offset(0f, 0f), 1f, 1f),
        Triple(Offset(size.width, 0f), -1f, 1f),
        Triple(Offset(0f, size.height), 1f, -1f),
        Triple(Offset(size.width, size.height), -1f, -1f),
    )
    for ((corner, dx, dy) in corners) {
        path.moveTo(corner.x, corner.y + dy * arm)
        path.lineTo(corner.x, corner.y)
        path.lineTo(corner.x + dx * arm, corner.y)
    }
    drawPath(path, color, style = Stroke(width = strokeWidth, cap = StrokeCap.Round))
}

@Composable
private fun CameraPreview(modifier: Modifier = Modifier, onPayload: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val latest by rememberUpdatedState(onPayload)
    val description = stringResource(R.string.scan_camera)
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val analyzer = remember { QrFrameAnalyzer { payload -> latest(payload) } }
    DisposableEffect(lifecycleOwner) {
        var provider: ProcessCameraProvider? = null
        var disposed = false
        val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val analysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
            .also { it.setAnalyzer(analyzer.executor, analyzer) }
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (disposed) return@addListener
            val ready = runCatching { future.get() }.getOrNull() ?: return@addListener
            provider = ready
            runCatching {
                ready.unbind(preview, analysis)
                ready.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            disposed = true
            analysis.clearAnalyzer()
            provider?.unbind(preview, analysis)
        }
    }
    DisposableEffect(analyzer) { onDispose { analyzer.close() } }
    AndroidView({ previewView }, modifier.semantics { contentDescription = description })
}

private class QrFrameAnalyzer(private val onPayload: (String) -> Unit) : ImageAnalysis.Analyzer {
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
