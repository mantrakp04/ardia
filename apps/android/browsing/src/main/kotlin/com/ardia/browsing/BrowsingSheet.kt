package com.ardia.browsing

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaThemeState
import com.ardia.design.BrowseLayout
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.MenuLayout
import com.ardia.design.Motion
import com.ardia.design.profileBackdrop
import com.ardia.design.rememberTrayDragState
import com.ardia.design.trayDismissDrag

@Composable
internal fun BrowsingSheet(
    visible: Boolean,
    onDismiss: () -> Unit,
    tag: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val progress = remember { Animatable(if (visible) 1f else 0f) }
    val motion = ArdiaThemeState.motion(if (visible) Motion.searchRise else Motion.trayDismiss)
    LaunchedEffect(visible) { progress.animateTo(if (visible) 1f else 0f, motion.spec()) }
    if (!visible && progress.value == 0f) return
    val drag = rememberTrayDragState()
    LaunchedEffect(visible) { if (visible) drag.reset() }
    val look = ArdiaThemeState.look
    val dark = LocalArdiaDarkTheme.current
    val density = LocalDensity.current
    var heightPx by remember { mutableFloatStateOf(0f) }
    val shape = RoundedCornerShape(topStart = MenuLayout.sheetRadius, topEnd = MenuLayout.sheetRadius)
    BoxWithConstraints(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics {}
                .drawBehind { drawRect(Color.Black, alpha = BrowseLayout.trayDim * progress.value * (1f - drag.progress(MenuLayout.sheetRadius * 8))) }
                .pointerInput(visible) { if (visible) detectTapGestures { onDismiss() } },
        )
        Box(
            Modifier
                .testTag(tag)
                .align(Alignment.BottomCenter)
                .statusBarsPadding()
                .fillMaxWidth()
                .heightIn(max = maxHeight - 24.dp)
                .onSizeChanged { heightPx = it.height.toFloat() }
                .graphicsLayer {
                    translationY = (1f - progress.value) * heightPx + drag.offsetDp * density.density
                }
                .clip(shape)
                .trayDismissDrag(drag, trayHeight = with(density) { heightPx.toDp() }, onDismiss = onDismiss, enabled = visible),
        ) {
            Box(Modifier.matchParentSize().profileBackdrop(look, dark))
            Column(Modifier.fillMaxWidth().navigationBarsPadding(), content = content)
        }
    }
}
