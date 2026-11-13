package com.ardia.browser.android

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.design.Radius
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

object SheetLayout {
    const val BACKGROUND_SHRINK = 0.06f
    const val SCRIM_ALPHA = 0.25f
    const val DISMISS_SHARE = 0.25f
    const val PREDICTIVE_PEEK = 0.12f
    val backgroundRadius = 24.dp
    val topGap = 10.dp
    val flingDismissVelocity = 1_200.dp
}

class SheetPosition(private val scope: CoroutineScope) {
    val offset = Animatable(0f)
    var height by mutableStateOf(0f)

    val progress: Float get() = if (height <= 0f) 0f else (1f - offset.value / height).coerceIn(0f, 1f)

    fun dragBy(delta: Float): Float {
        val target = (offset.value + delta).coerceIn(0f, height)
        val used = target - offset.value
        scope.launch { offset.snapTo(target) }
        return used
    }

    suspend fun settle(velocity: Float, flingDismiss: Float, dismiss: () -> Unit) {
        val shouldDismiss = velocity > flingDismiss || (velocity >= 0f && offset.value > height * SheetLayout.DISMISS_SHARE)
        if (shouldDismiss) dismiss() else offset.animateTo(0f, Motion.smooth.spec())
    }
}

@Composable
fun <T : Any> SheetHost(
    sheet: T?,
    onDismiss: () -> Unit,
    onProgress: (Float) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit,
) {
    var shown by remember { mutableStateOf(sheet) }
    val scope = rememberCoroutineScope()
    val position = remember { SheetPosition(scope) }
    val reduceMotion = LocalReduceMotion.current
    val dismiss by rememberUpdatedState(onDismiss)
    val report by rememberUpdatedState(onProgress)
    LaunchedEffect(sheet) {
        if (sheet != null) {
            val wasHidden = shown == null
            shown = sheet
            if (wasHidden) {
                snapshotFlow { position.height }.first { it > 0f }
                position.offset.snapTo(position.height)
            }
            position.offset.animateTo(0f, (if (reduceMotion) Motion.reducedSettle else Motion.smooth).spec())
        } else if (shown != null) {
            position.offset.animateTo(position.height, (if (reduceMotion) Motion.reducedFade else Motion.trayDismiss).spec())
            shown = null
        }
    }
    LaunchedEffect(position) { snapshotFlow { if (shown == null) 0f else position.progress }.collect { report(it) } }
    val current = shown ?: return
    val density = LocalDensity.current
    val flingDismiss = with(density) { SheetLayout.flingDismissVelocity.toPx() }
    val connection = remember(position) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput || available.y >= 0f || position.offset.value <= 0f) return Offset.Zero
                return Offset(0f, position.dragBy(available.y))
            }

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
                return Offset(0f, position.dragBy(available.y))
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                if (position.offset.value <= 0f) return Velocity.Zero
                position.settle(available.y, flingDismiss) { dismiss() }
                return available
            }
        }
    }
    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = position.progress }
                .background(Color.Black.copy(alpha = SheetLayout.SCRIM_ALPHA))
                .clearAndSetSemantics {}
                .blocksTouchesBelow(),
        )
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(top = SheetLayout.topGap),
        ) {
            val height = constraints.maxHeight.toFloat()
            if (position.height != height) position.height = height
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        translationY = position.offset.value
                        clip = true
                        shape = RoundedCornerShape(topStart = Radius.sheet, topEnd = Radius.sheet)
                    }
                    .background(MaterialTheme.colorScheme.background)
                    .blocksTouchesBelow()
                    .nestedScroll(connection)
                    .draggable(
                        rememberDraggableState { delta -> position.dragBy(delta) },
                        Orientation.Vertical,
                        onDragStopped = { velocity -> position.settle(velocity, flingDismiss) { dismiss() } },
                    )
                    .testTag(RootTags.SHEET),
            ) {
                PredictiveBackHandler(enabled = sheet != null) { progress ->
                    try {
                        progress.collect { event -> position.offset.snapTo(position.height * SheetLayout.PREDICTIVE_PEEK * event.progress) }
                        dismiss()
                    } catch (cancelled: CancellationException) {
                        scope.launch { position.offset.animateTo(0f, Motion.snappy.spec()) }
                        throw cancelled
                    }
                }
                content(current)
            }
        }
    }
}

fun Modifier.coveredFromAccessibility(covered: Boolean): Modifier = if (covered) clearAndSetSemantics {} else this

fun Modifier.blocksTouchesBelow(): Modifier = pointerInput(Unit) {
    awaitPointerEventScope {
        while (true) awaitPointerEvent()
    }
}

@Composable
fun FullScreenCover(visible: Boolean, onDismissRequest: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val reduceMotion = LocalReduceMotion.current
    AnimatedVisibility(
        visible = visible,
        enter = if (reduceMotion) fadeIn(Motion.reducedFade.spec()) else slideInVertically(Motion.smooth.spec()) { it },
        exit = if (reduceMotion) fadeOut(Motion.reducedFade.spec()) else slideOutVertically(Motion.trayDismiss.spec()) { it },
        modifier = modifier.fillMaxSize(),
    ) {
        Box(Modifier.fillMaxSize().blocksTouchesBelow()) {
            BackHandler(enabled = visible, onBack = onDismissRequest)
            content()
        }
    }
}
