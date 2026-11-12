package com.ardia.search

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.design.ArdiaLogoMark
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.FrostedBackdrop
import com.ardia.design.FrostedStyle
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LocalReduceMotion
import com.ardia.design.ProfileBackdrop
import com.ardia.design.Spacing
import com.ardia.design.SwiftEasing
import com.ardia.design.frosted
import com.ardia.design.frostedBackdropSource
import com.ardia.design.medium
import com.ardia.design.rememberFrostedBackdrop
import com.ardia.design.semibold
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Stable
class LevelHistory(val size: Int = BARS) {
    private val values = FloatArray(size)
    private var head = 0
    var version by mutableIntStateOf(0)
        private set

    fun push(level: Float) {
        values[head] = level
        head = (head + 1) % size
        version += 1
    }

    fun at(index: Int): Float = values[(head + index) % size]

    companion object {
        const val BARS = 24
    }
}

@Composable
fun VoiceSearchView(model: AppModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberMainScope()
    val pending = remember { arrayOfNulls<CompletableDeferred<Boolean>>(1) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pending[0]?.complete(granted)
        pending[0] = null
    }
    val currentLauncher by rememberUpdatedState(launcher)
    val dictation = remember {
        DictationSession(
            scope = scope,
            requestAccess = {
                val granted = if (context.hasMicrophone()) {
                    true
                } else {
                    val answer = CompletableDeferred<Boolean>()
                    pending[0] = answer
                    currentLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    answer.await()
                }
                when {
                    !granted -> DictationAccess.Denied
                    !SpeechRecorder.isAvailable(context) -> DictationAccess.Unavailable(DictationProblem.Service)
                    else -> DictationAccess.Granted
                }
            },
            startRecorder = { events -> SpeechRecorder.start(context, events) },
        )
    }
    val levels = remember { LevelHistory() }

    LaunchedEffect(dictation) { withContext(Dispatchers.Main.immediate) { dictation.start() } }
    LaunchedEffect(dictation) { snapshotFlow { dictation.level }.collect(levels::push) }
    DisposableEffect(dictation) { onDispose { dictation.stop() } }

    fun close() {
        dictation.stop()
        model.browse.isVoicePresented = false
    }

    BackHandler { close() }

    CompositionLocalProvider(LocalArdiaDarkTheme provides true) {
        val frost = rememberFrostedBackdrop()
        Box(modifier.fillMaxSize()) {
            ProfileBackdrop(Modifier.fillMaxSize().frostedBackdropSource(frost))
            Column(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(horizontal = Spacing.medium)
                    .padding(bottom = Spacing.medium),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.section),
            ) {
                Spacer(Modifier.weight(1f))
                LevelLogo(dictation)
                Transcript(dictation, context)
                Spacer(Modifier.weight(1f))
                Waveform(dictation, levels)
                Controls(
                    dictation = dictation,
                    frost = frost,
                    onTryAgain = { scope.launch { dictation.start() } },
                    onSearch = { text ->
                        dictation.stop()
                        model.openSearch(text)
                        model.browse.isVoicePresented = false
                    },
                )
            }
            GlassCircle(
                icon = ArdiaSymbols.xmark,
                label = stringResource(R.string.voice_cancel),
                frost = frost,
                onClick = ::close,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(end = Spacing.page, top = Spacing.tight),
            )
        }
    }
}

@Composable
private fun LevelLogo(dictation: DictationSession) {
    val reduceMotion = LocalReduceMotion.current
    val level = animateFloatAsState(dictation.level, tween(120, easing = SwiftEasing.easeOut), label = "voiceLevel")
    ArdiaLogoMark(
        Modifier
            .size(128.dp)
            .graphicsLayer {
                val scale = if (reduceMotion) 1f else 0.92f + level.value * 0.16f
                scaleX = scale
                scaleY = scale
                shadowElevation = 12.dp.toPx()
                shape = CircleShape
                clip = false
                ambientShadowColor = Color.Black.copy(alpha = 0.15f)
                spotShadowColor = Color.Black.copy(alpha = 0.15f)
            },
    )
}

@Composable
private fun Transcript(dictation: DictationSession, context: Context) {
    when (val state = dictation.state) {
        DictationSession.State.Denied -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            Text(stringResource(R.string.voice_permission_title), style = ArdiaType.title3.semibold, color = Color.White, textAlign = TextAlign.Center)
            Text(
                stringResource(R.string.voice_permission_detail),
                style = ArdiaType.subheadline,
                color = Color.White.copy(alpha = 0.8f),
                textAlign = TextAlign.Center,
            )
            GlassPill(text = stringResource(R.string.voice_open_settings), icon = null, frost = null, modifier = Modifier.padding(top = Spacing.tight)) {
                context.openAppSettings()
            }
        }
        is DictationSession.State.Unavailable -> Text(
            stringResource(problemText(state.problem)),
            style = ArdiaType.title3.semibold,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        else -> {
            val transcript = dictation.transcript
            AnimatedContent(
                targetState = transcript,
                transitionSpec = { fadeIn(tween(150)) togetherWith fadeOut(tween(150)) },
                label = "transcript",
            ) { shown ->
                Text(
                    shown.ifEmpty { stringResource(R.string.voice_listening) },
                    style = ArdiaType.title2.semibold,
                    color = Color.White.copy(alpha = if (shown.isEmpty()) 0.7f else 1f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .background(Color.Black.copy(alpha = 0.18f), RoundedCornerShape(22.dp))
                        .padding(horizontal = Spacing.medium, vertical = Spacing.small)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

private fun problemText(problem: DictationProblem): Int = when (problem) {
    DictationProblem.Language -> R.string.voice_unavailable_language
    DictationProblem.Service -> R.string.voice_unavailable
    DictationProblem.HeardNothing -> R.string.voice_heard_nothing
}

@Composable
private fun Waveform(dictation: DictationSession, levels: LevelHistory) {
    val listening = dictation.state == DictationSession.State.Listening
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .graphicsLayer { alpha = if (listening) 1f else 0f }
            .semantics { invisibleToUser() },
    ) {
        levels.version
        val bar = 4.dp.toPx()
        val gap = 4.dp.toPx()
        val total = levels.size * bar + (levels.size - 1) * gap
        var x = (size.width - total) / 2
        val color = Color.White.copy(alpha = 0.85f)
        for (index in 0 until levels.size) {
            val height = (6.dp.toPx() + levels.at(index) * 38.dp.toPx()).coerceAtMost(size.height)
            drawRoundRect(color, Offset(x, (size.height - height) / 2), Size(bar, height), CornerRadius(bar / 2, bar / 2))
            x += bar + gap
        }
    }
}

@Composable
private fun Controls(dictation: DictationSession, frost: FrostedBackdrop, onTryAgain: () -> Unit, onSearch: (String) -> Unit) {
    val text = dictation.transcript.trim()
    val state = dictation.state
    Box(Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
        when {
            state == DictationSession.State.Listening -> GlassPill(stringResource(R.string.voice_done), ArdiaSymbols.stopFill, frost) { dictation.stop() }
            text.isNotEmpty() -> GlassPill(stringResource(R.string.voice_search), null, frost) { onSearch(text) }
            state != DictationSession.State.Requesting -> GlassPill(stringResource(R.string.voice_try_again), ArdiaSymbols.micFill, frost, onClick = onTryAgain)
        }
    }
}

@Composable
private fun GlassPill(text: String, icon: ImageVector?, frost: FrostedBackdrop?, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 50.dp)
            .frosted(frost, RoundedCornerShape(50), FrostedStyle.glass)
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = text
                role = Role.Button
                onClick {
                    onClick()
                    true
                }
            }
            .padding(horizontal = Spacing.medium),
        horizontalArrangement = Arrangement.spacedBy(Spacing.tight, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(17.dp), tint = Color.White)
        Text(text, style = ArdiaType.body.medium, color = Color.White)
    }
}

@Composable
private fun GlassCircle(icon: ImageVector, label: String, frost: FrostedBackdrop, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(44.dp)
            .frosted(frost, CircleShape, FrostedStyle.glass)
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                onClick {
                    onClick()
                    true
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(17.dp), tint = Color.White)
    }
}

private fun Context.hasMicrophone(): Boolean = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

private fun Context.openAppSettings() {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { startActivity(intent) }
}
