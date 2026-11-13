package com.ardia.design

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Stable
internal class LoadingLineController(private val scope: CoroutineScope) {
    val track = LoadProgress()
    val fraction = Animatable(0f)
    val alpha = Animatable(0f)
    var progress = 0.0
    var isLoading = false
    private var revealJob: Job? = null
    private var motionJob: Job? = null

    fun begin() {
        track.start()
        track.advance(progress)
        if (track.phase == LoadProgress.Phase.Waiting) scope.launch { fraction.snapTo(track.fraction.toFloat()) }
        scheduleReveal()
    }

    fun end() {
        revealJob?.cancel()
        if (track.phase != LoadProgress.Phase.Showing) {
            val wasWaiting = track.phase == LoadProgress.Phase.Waiting
            track.finish()
            if (wasWaiting) scope.launch { syncImmediately() }
            return
        }
        track.finish()
        motionJob?.cancel()
        motionJob = scope.launch {
            fraction.animateTo(1f, Motion.progressFill.spec())
            track.fade()
            alpha.animateTo(0f, Motion.progressFade.spec())
            track.settle()
            fraction.snapTo(0f)
            if (isLoading) track.advance(progress)
            fraction.snapTo(track.fraction.toFloat())
            scheduleReveal()
        }
    }

    fun advance(value: Double) {
        progress = value
        if (track.phase != LoadProgress.Phase.Showing) {
            track.advance(value)
            if (track.phase == LoadProgress.Phase.Waiting) scope.launch { fraction.snapTo(track.fraction.toFloat()) }
            return
        }
        track.advance(value)
        motionJob?.cancel()
        motionJob = scope.launch { fraction.animateTo(track.fraction.toFloat(), Motion.progressAdvance.spec()) }
    }

    private fun scheduleReveal() {
        if (track.phase != LoadProgress.Phase.Waiting) return
        revealJob?.cancel()
        revealJob = scope.launch {
            delay(Motion.progressRevealDelayMillis)
            track.reveal()
            track.advance(progress)
            motionJob?.cancel()
            motionJob = launch { fraction.animateTo(track.fraction.toFloat(), Motion.progressReveal.spec()) }
            alpha.animateTo(1f, Motion.progressReveal.spec())
        }
    }

    private suspend fun syncImmediately() {
        fraction.snapTo(track.fraction.toFloat())
        alpha.snapTo(if (track.isVisible) 1f else 0f)
    }

    fun cancel() {
        revealJob?.cancel()
        motionJob?.cancel()
    }
}

@Composable
fun LoadingLine(progress: Double, isLoading: Boolean, modifier: Modifier = Modifier, color: Color = BrowsePalette.loadingBorder.current) {
    val scope = rememberCoroutineScope()
    val controller = remember { LoadingLineController(scope) }
    SideEffect {
        controller.isLoading = isLoading
    }
    LaunchedEffect(isLoading) {
        controller.isLoading = isLoading
        controller.progress = progress
        if (isLoading) controller.begin() else controller.end()
    }
    LaunchedEffect(progress) { controller.advance(progress) }
    DisposableEffect(controller) { onDispose { controller.cancel() } }
    Box(
        modifier
            .fillMaxWidth()
            .height(BrowseLayout.progressHeight)
            .clearAndSetSemantics {}
            .drawBehind {
                val opacity = controller.alpha.value
                if (opacity <= 0f) return@drawBehind
                drawRect(color, size = Size(size.width * controller.fraction.value, size.height), alpha = opacity)
            },
    )
}
