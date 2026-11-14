package com.ardia.browsing

import android.graphics.Bitmap
import android.os.Build
import android.view.RoundedCorner
import androidx.compose.animation.core.animate
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChangeIgnoreConsumed
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.PagerModel
import com.ardia.browser.PageTone
import com.ardia.design.Motion
import com.ardia.design.PageLoadingPlaceholder
import com.ardia.design.PagerPhysics
import com.ardia.design.TabsLayout
import com.ardia.store.BrowserTab
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs

@Stable
internal class TabPager(
    private val model: AppModel,
    val pager: PagerModel,
    private val scope: CoroutineScope,
    private val onSwitchTick: () -> Unit,
) {
    var widthDp: Float = 0f
    var reduceMotion: Boolean = false
    var presented: Float by mutableFloatStateOf(0f)
        private set
    private var settleJob: Job? = null

    val isActive: Boolean get() = pager.isActive

    fun grab(): Boolean {
        if (pager.isActive) {
            catch()
        } else {
            if (!pager.begin(model.swipeOrder, model.tabs.selectedTabId)) return false
            presented = 0f
            rememberCurrentCover()
        }
        pager.isTracking = true
        pager.trackingBase = PagerPoses.rawOffset(pager.offset, pager.hasLeft, pager.hasRight)
        return true
    }

    fun track(rawDp: Float) {
        val resolved = PagerPhysics.resolvedOffset(rawDp.toDouble(), pager.hasLeft, pager.hasRight, widthDp.toDouble()).toFloat()
        pager.offset = resolved
        presented = resolved
    }

    fun release(velocityDp: Float) {
        if (!pager.isTracking) return
        pager.isTracking = false
        val target = PagerPhysics.snapTarget(pager.offset.toDouble(), velocityDp.toDouble(), widthDp.toDouble(), pager.hasLeft, pager.hasRight)
        settle(target, velocityDp)
    }

    fun settle(target: Int, velocityDp: Float) {
        val destination = target * widthDp
        val neighbor = when {
            target > 0 -> pager.left
            target < 0 -> pager.right
            else -> null
        }
        if (neighbor != null) onSwitchTick()
        settleJob?.cancel()
        val from = presented
        pager.offset = from
        pager.startSettle(destination, velocityDp.coerceIn(-MAX_VELOCITY, MAX_VELOCITY))
        val generation = pager.generation
        settleJob = scope.launch {
            if (reduceMotion) {
                animate(from, destination, animationSpec = Motion.pagerFade.spec()) { value, _ -> presented = value }
            } else {
                var done = false
                while (!done) {
                    done = androidx.compose.runtime.withFrameNanos { frame ->
                        val now = System.nanoTime()
                        val time = if (abs(frame - now) < CLOCK_TOLERANCE_NANOS) frame else now
                        presented = pager.presentedOffset(time)
                        pager.isSettled(time)
                    }
                }
            }
            presented = destination
            if (pager.generation != generation || pager.isTracking) return@launch
            finish(neighbor)
        }
    }

    fun cancel() {
        settleJob?.cancel()
        settleJob = null
        if (pager.isActive) pager.reset()
        presented = 0f
    }

    private fun catch() {
        settleJob?.cancel()
        settleJob = null
        val caught = presented
        pager.catchSettle()
        pager.offset = caught
        presented = caught
    }

    private fun finish(neighbor: BrowserTab?) {
        if (neighbor != null) {
            model.browse.freezeOrder(pager.order.map { it.id })
            model.openTab(neighbor.id)
        }
        pager.reset()
        presented = 0f
    }

    private fun rememberCurrentCover() {
        val id = model.tabs.selectedTabId ?: return
        val page = model.page(id) ?: return
        val state = page.state.value
        if (state.isLoading || state.failure != null || !state.isLive) return
        scope.launch {
            val image = page.snapshot() ?: return@launch
            model.browse.covers.store(image, id)
        }
    }

    fun warmNeighbors() {
        val order = model.swipeOrder
        val index = order.indexOfFirst { it.id == model.tabs.selectedTabId }
        if (index < 0) return
        val neighbors = listOfNotNull(order.getOrNull(index - 1), order.getOrNull(index + 1))
        val keep = neighbors.map { it.id }.toHashSet()
        pager.images.keys.filter { it !in keep }.forEach { pager.images.remove(it) }
        for (tab in neighbors) {
            if (pager.images[tab.id] != null || model.browse.covers.image(tab.id) != null || model.deck.memoryImage(tab.id) != null) continue
            if (tab.snapshotFileName == null) continue
            scope.launch {
                val image = model.snapshotImage(tab) ?: return@launch
                pager.images[tab.id] = image
            }
        }
    }

    fun cover(tab: BrowserTab): Bitmap? = model.browse.covers.image(tab.id) ?: model.deck.memoryImage(tab.id) ?: pager.images[tab.id]

    companion object {
        const val MAX_VELOCITY = 4000f
        const val MINIMUM_DISTANCE_DP = 14f
        private const val CLOCK_TOLERANCE_NANOS = 1_000_000_000L
    }
}

internal fun Modifier.tabPagerDrag(pager: TabPager, enabled: Boolean): Modifier {
    if (!enabled) return this
    return pointerInput(pager) {
        val minimum = TabPager.MINIMUM_DISTANCE_DP * density
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val tracker = VelocityTracker()
            tracker.addPosition(down.uptimeMillis, down.position)
            var total = Offset.Zero
            var tracking = false
            var activation = 0f
            try {
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    total += change.positionChangeIgnoreConsumed()
                    tracker.addPosition(change.uptimeMillis, change.position)
                    if (!change.pressed) break
                    if (!tracking) {
                        if (total.getDistance() < minimum) continue
                        if (abs(total.x) <= abs(total.y) || !pager.grab()) break
                        tracking = true
                        activation = total.x
                    }
                    pager.track(pager.pager.trackingBase + (total.x - activation) / density)
                    change.consume()
                }
            } finally {
                if (tracking) pager.release(tracker.calculateVelocity().x / density)
            }
        }
    }
}

internal fun Modifier.outgoingPagerPose(pager: TabPager, cornerRadius: Dp): Modifier = graphicsLayer {
    val model = pager.pager
    if (!model.isActive) return@graphicsLayer
    val offset = pager.presented
    val width = pager.widthDp
    translationX = PagerPoses.outgoingX(offset, width, model.hasLeft, model.hasRight, pager.reduceMotion) * density
    val scale = PagerPoses.outgoingScale(offset, width, model.hasLeft, model.hasRight, pager.reduceMotion)
    scaleX = scale
    scaleY = scale
    shape = RoundedCornerShape(cornerRadius)
    clip = true
}.drawWithContent {
    drawContent()
    val model = pager.pager
    if (!model.isActive) return@drawWithContent
    val dim = PagerPoses.outgoingDim(pager.presented, pager.widthDp, model.hasLeft, model.hasRight, pager.reduceMotion)
    if (dim > 0f) drawRect(Color.Black, alpha = dim)
}

@Composable
internal fun PagerNeighbors(model: AppModel, pager: TabPager, statusHeight: Dp, cornerRadius: Dp) {
    val state = pager.pager
    if (!state.isActive) return
    Box(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        state.left?.let { PagerCard(model, pager, it, side = -1, statusHeight, cornerRadius) }
        state.right?.let { PagerCard(model, pager, it, side = 1, statusHeight, cornerRadius) }
    }
}

@Composable
private fun PagerCard(model: AppModel, pager: TabPager, tab: BrowserTab, side: Int, statusHeight: Dp, cornerRadius: Dp) {
    val look = com.ardia.design.ArdiaThemeState.look
    val surface = look.surface.current
    val tone = model.tone(tab, model.page(tab.id)?.state?.value)
    val shadowWidth = 36.dp
    Box(
        Modifier
            .fillMaxSize()
            .graphicsLayer {
                val m = pager.pager
                val offset = pager.presented
                val width = pager.widthDp
                translationX = PagerPoses.incomingX(side, offset, width, m.hasLeft, m.hasRight, pager.reduceMotion) * density
                alpha = PagerPoses.incomingOpacity(side, offset, width, m.hasLeft, m.hasRight, pager.reduceMotion)
            }
            .drawBehind {
                val m = pager.pager
                val shadow = PagerPoses.incomingShadow(side, pager.presented, pager.widthDp, m.hasLeft, m.hasRight, pager.reduceMotion)
                if (shadow <= 0f) return@drawBehind
                val widthPx = shadowWidth.toPx()
                val inset = cornerRadius.toPx() * 0.6f
                val trailing = side < 0
                val left = if (trailing) size.width else -widthPx
                val colors = listOf(Color.Black.copy(alpha = 0f), Color.Black.copy(alpha = 0.08f), Color.Black.copy(alpha = 0.26f))
                val brush = if (trailing) {
                    Brush.horizontalGradient(colors.reversed(), startX = left, endX = left + widthPx)
                } else {
                    Brush.horizontalGradient(colors, startX = left, endX = left + widthPx)
                }
                drawRect(brush, topLeft = Offset(left, inset), size = Size(widthPx, size.height - inset * 2), alpha = shadow)
            },
    ) {
        Column(Modifier.fillMaxSize().clip(RoundedCornerShape(cornerRadius)).background(surface)) {
            Box(Modifier.fillMaxWidth().height(statusHeight).background(tone.top?.let { Color(it) } ?: surface))
            PagerSnapshot(model, pager, tab, Modifier.fillMaxWidth().weight(1f))
        }
    }
}

@Composable
private fun PagerSnapshot(model: AppModel, pager: TabPager, tab: BrowserTab, modifier: Modifier) {
    val surface = com.ardia.design.ArdiaThemeState.look.surface.current
    var stored by remember(tab.id) { mutableStateOf<Bitmap?>(null) }
    val memory = pager.cover(tab)
    LaunchedEffect(tab.id, tab.snapshotFileName) {
        if (memory == null && tab.snapshotFileName != null) stored = model.snapshotImage(tab)
    }
    val image = memory ?: stored
    Box(modifier.background(surface), contentAlignment = Alignment.TopCenter) {
        if (image != null) {
            val bitmap = remember(image) { image.asImageBitmap() }
            Image(bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
        } else {
            PageLoadingPlaceholder(title = tab.title, url = tab.url, backdrop = surface, faviconUrl = tab.faviconUrl, themeColorHex = tab.themeColorHex)
        }
    }
}

@Composable
internal fun rememberDisplayCornerRadius(): Dp {
    val view = LocalView.current
    val density = LocalDensity.current
    return remember(view) {
        val insets = view.rootWindowInsets
        val radius = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && insets != null) {
            insets.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)?.radius ?: 0
        } else {
            0
        }
        if (radius > 0) with(density) { radius.toDp() } else TabsLayout.displayCornerRadius
    }
}

internal fun PageTone.topColor(): Color? = top?.let { Color(it) }
