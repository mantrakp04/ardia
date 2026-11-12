package com.ardia.search

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imeAnimationSource
import androidx.compose.foundation.layout.imeAnimationTarget
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.design.BrowseLayout
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.design.Spacing
import com.ardia.design.rememberTrayDragState
import com.ardia.design.trayDismissDrag
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SearchTrayHost(model: AppModel, modifier: Modifier = Modifier) {
    val scope = rememberMainScope()
    val density = LocalDensity.current
    val reduceMotion = LocalReduceMotion.current
    val drag = rememberTrayDragState()
    val ime = WindowInsets.ime
    val imeSource = WindowInsets.imeAnimationSource
    val imeTarget = WindowInsets.imeAnimationTarget
    val navigation = WindowInsets.navigationBars
    val keyboard = remember(ime, imeSource, imeTarget, navigation, density) { KeyboardReader(ime, imeSource, imeTarget, navigation, density) }
    val presentation = remember(keyboard) { TrayPresentation(scope, keyboard) }
    var containerHeight by remember { mutableIntStateOf(0) }
    val request = model.browse.search

    LaunchedEffect(request) {
        if (request != null) {
            drag.reset()
            presentation.present(request, model.mayFocusSearch, if (reduceMotion) Motion.reducedSettle else Motion.searchRise)
            model.browse.trayHoldsKeyboard = true
        } else {
            presentation.beginClosing(if (reduceMotion) Motion.reducedFade else Motion.trayDismiss) {
                drag.reset()
                model.browse.trayHoldsKeyboard = false
                model.refreshRecents()
                scope.launch {
                    delay(RECENTS_SECOND_PASS_MILLIS)
                    if (presentation.shown == null) model.refreshRecents()
                }
            }
        }
    }

    LaunchedEffect(presentation) {
        snapshotFlow { keyboard.current() }.collect {
            presentation.keyboardMoved(keyboard.progress(), drag.isDragging)
        }
    }

    LaunchedEffect(presentation) {
        snapshotFlow { drag.isDragging }.drop(1).collect { dragging ->
            if (!dragging && model.browse.search != null) {
                presentation.settleAfterDrag(model.mayFocusSearch, if (reduceMotion) Motion.reducedSettle else Motion.traySettle)
            }
        }
    }

    val shown = presentation.shown
    PredictiveBackHandler(enabled = shown != null && !presentation.isClosing) { events ->
        try {
            events.collect { event -> presentation.back.snapTo(event.progress) }
            model.cancelSearch()
        } catch (cancelled: CancellationException) {
            scope.launch { presentation.back.animateTo(0f, Motion.traySettle.spec()) }
            throw cancelled
        }
    }

    Box(modifier.fillMaxSize().onSizeChanged { containerHeight = it.height }) {
        if (shown == null) return@Box
        val isUp by remember(presentation) { derivedStateOf { presentation.isUp() } }
        val dimTarget = if (isUp) 1f else 0f
        val dim = animateFloatAsState(dimTarget, (if (reduceMotion) Motion.surfaceFade else Motion.trayDim).spec(), label = "trayDim")
        val closeLabel = stringResource(R.string.search_close)
        val interaction = remember { MutableInteractionSource() }
        val dimInteractive = isUp && !presentation.isClosing
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val travel = presentation.trayHeight + presentation.lift()
                    alpha = dim.value * (1f - TrayLift.dragProgress(drag.offsetDp, travel))
                }
                .background(Color.Black.copy(alpha = if (shown.origin == BrowseSession.SearchOrigin.Page) BrowseLayout.trayDim else 0.001f))
                .then(
                    if (dimInteractive) {
                        Modifier
                            .clickable(interactionSource = interaction, indication = null) { model.cancelSearch() }
                            .clearAndSetSemantics {
                                contentDescription = closeLabel
                                role = Role.Button
                                onClick {
                                    model.cancelSearch()
                                    true
                                }
                            }
                    } else {
                        Modifier.clearAndSetSemantics {}
                    },
                ),
        )

        val fontScale = density.fontScale
        val maxHeight by remember(presentation, fontScale) {
            derivedStateOf {
                val preferred = BrowseLayout.sheetAboveKeyboard.value + BrowseLayout.searchFieldHeight.value * (fontScale - 1f)
                val container = containerHeight / density.density
                TrayLift.maxHeight(preferred, container, presentation.budgetLift(), Spacing.tight.value)
            }
        }
        val trayMax = maxHeight.dp
        val dismissDrag = Modifier.trayDismissDrag(
            state = drag,
            trayHeight = trayMax,
            onDismiss = { model.cancelSearch() },
            onReleaseKeyboard = { presentation.releaseKeyboard() },
            settleMotion = if (reduceMotion) Motion.reducedSettle else Motion.traySettle,
            enabled = !presentation.isClosing,
        )
        key(presentation.count) {
            SearchTray(
                model = model,
                request = shown,
                presentation = presentation,
                maxHeight = trayMax,
                dismissDrag = dismissDrag,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .onSizeChanged { presentation.trayHeight = it.height / density.density }
                    .offset {
                        val radius = BrowseLayout.sheetTopRadius.value
                        val backDrop = presentation.back.value * BACK_TRAVEL
                        val y = TrayLift.offset(
                            lift = presentation.lift(),
                            drag = drag.offsetDp + backDrop,
                            rise = presentation.rise(reduceMotion),
                            trayHeight = presentation.trayHeight,
                            cornerRadius = radius,
                        )
                        IntOffset(0, (y * density.density).roundToInt())
                    }
                    .graphicsLayer {
                        if (reduceMotion) alpha = if (presentation.isUp()) 1f else 0f
                    },
            )
        }
    }
}

private const val BACK_TRAVEL = 72f
private const val RECENTS_SECOND_PASS_MILLIS = 3_000L
