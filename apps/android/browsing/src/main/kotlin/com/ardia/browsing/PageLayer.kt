package com.ardia.browsing

import android.content.Context
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.ardia.browser.NetworkFailure
import com.ardia.browser.Page
import com.ardia.browser.PageLoadFailure
import com.ardia.browser.PageState
import com.ardia.browser.PageSurface
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaThemeState
import com.ardia.design.ArdiaType
import com.ardia.design.BrowsePalette
import com.ardia.design.Layout
import com.ardia.design.Motion
import com.ardia.design.PageLoadingPlaceholder
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.semibold
import com.ardia.store.BrowserTab
import com.ardia.store.SwipeNavigationMode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.roundToInt

@Composable
internal fun <T> Page.select(selector: (PageState) -> T): State<T> {
    val flow = remember(this) { state.map(selector).distinctUntilChanged() }
    return flow.collectAsState(initial = selector(state.value))
}

@Stable
internal class PageGestures(private val scope: CoroutineScope) {
    var direction: SwipeDirection? by mutableStateOf(null)
        private set
    val progress = Animatable(0f)
    val targetAlpha = Animatable(1f)
    var pull: Float by mutableFloatStateOf(0f)
        private set
    var isRefreshing: Boolean by mutableStateOf(false)
        private set
    var widthPx: Float = 0f

    fun beginSwipe(direction: SwipeDirection) {
        this.direction = direction
        scope.launch {
            targetAlpha.snapTo(1f)
            progress.snapTo(0f)
        }
    }

    fun follow(translation: Float) {
        val direction = direction ?: return
        scope.launch { progress.snapTo(SwipeNavigationRules.progress(translation, direction, widthPx)) }
    }

    fun finishSwipe(commit: Boolean, page: Page) {
        val direction = direction ?: return
        scope.launch {
            progress.animateTo(if (commit) 1f else 0f, tween(220))
            if (!commit) {
                this@PageGestures.direction = null
                return@launch
            }
            if (direction == SwipeDirection.Back) page.goBack() else page.goForward()
            progress.snapTo(0f)
            delay(250)
            targetAlpha.animateTo(0f, tween(200))
            this@PageGestures.direction = null
        }
    }

    fun followPull(pulledDp: Float) {
        pull = PullToRefreshRules.distance(pulledDp)
    }

    fun finishPull(page: Page) {
        val triggered = PullToRefreshRules.triggers(pull)
        scope.launch {
            if (triggered) {
                isRefreshing = true
                page.reload()
                animatePull(REFRESH_HOLD_DP)
                withTimeoutOrNull(REFRESH_TIMEOUT_MILLIS) {
                    page.state.first { it.isLoading }
                    page.state.first { !it.isLoading }
                }
                isRefreshing = false
            }
            animatePull(0f)
        }
    }

    private suspend fun animatePull(to: Float) {
        val motion = Animatable(pull)
        motion.animateTo(to, Motion.snappy.spec()) { pull = value }
    }

    companion object {
        const val REFRESH_HOLD_DP = 56f
        const val REFRESH_TIMEOUT_MILLIS = 8_000L
    }
}

private enum class PageDrag { Undecided, Swipe, Pull }

internal fun Modifier.pageGestures(
    gestures: PageGestures,
    page: Page,
    swipeMode: SwipeNavigationMode,
    enabled: Boolean,
    onPullTriggerCrossed: () -> Unit,
): Modifier {
    if (!enabled) return this
    return pointerInput(gestures, page, swipeMode) {
        val slop = viewConfiguration.touchSlop
        val edge = SwipeNavigationRules.EDGE_DP * density
        val commit = Layout.swipeCommit.toPx()
        val flick = Layout.swipeFlickCommit.toPx()
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Main)
            if (gestures.direction != null || gestures.isRefreshing) return@awaitEachGesture
            val tracker = VelocityTracker()
            tracker.addPosition(down.uptimeMillis, down.position)
            var mode = PageDrag.Undecided
            var total = Offset.Zero
            var activation = Offset.Zero
            var crossed = false
            var ended = false
            try {
                while (true) {
                    val event = awaitPointerEvent(PointerEventPass.Main)
                    if (event.changes.size > 1 && mode == PageDrag.Undecided) return@awaitEachGesture
                    val change = event.changes.firstOrNull { it.id == down.id } ?: return@awaitEachGesture
                    if (!change.pressed) {
                        ended = true
                        break
                    }
                    if (mode == PageDrag.Undecided) {
                        if (change.isConsumed) return@awaitEachGesture
                        total += change.positionChange()
                        tracker.addPosition(change.uptimeMillis, change.position)
                        if (total.getDistance() < slop) continue
                        val state = page.state.value
                        val view = page.view.value
                        val direction = SwipeNavigationRules.direction(
                            mode = swipeMode,
                            dx = total.x,
                            dy = total.y,
                            startX = down.position.x,
                            width = size.width.toFloat(),
                            edge = edge,
                            canGoBack = state.canGoBack,
                            canGoForward = state.canGoForward,
                            canScrollLeft = view?.canScrollHorizontally(-1) == true,
                            canScrollRight = view?.canScrollHorizontally(1) == true,
                        )
                        val canScrollUp = view?.canScrollVertically(-1) == true || !state.isScrolledToTop
                        mode = when {
                            direction != null -> {
                                gestures.widthPx = size.width.toFloat()
                                gestures.beginSwipe(direction)
                                PageDrag.Swipe
                            }
                            PullToRefreshRules.begins(total.x, total.y, canScrollUp) && !state.isLoading -> PageDrag.Pull
                            else -> return@awaitEachGesture
                        }
                        activation = total
                    } else {
                        total += change.positionChange()
                        tracker.addPosition(change.uptimeMillis, change.position)
                    }
                    when (mode) {
                        PageDrag.Swipe -> gestures.follow(total.x - activation.x)
                        PageDrag.Pull -> {
                            gestures.followPull((total.y - activation.y) / density)
                            val past = PullToRefreshRules.triggers(gestures.pull)
                            if (past && !crossed) onPullTriggerCrossed()
                            crossed = past
                        }
                        PageDrag.Undecided -> Unit
                    }
                    change.consume()
                }
            } finally {
                when (mode) {
                    PageDrag.Swipe -> {
                        val direction = gestures.direction
                        val velocity = tracker.calculateVelocity().x
                        if (direction != null) {
                            val signed = SwipeNavigationRules.signed(total.x - activation.x, direction)
                            val signedVelocity = SwipeNavigationRules.signed(velocity, direction)
                            gestures.finishSwipe(ended && SwipeNavigationRules.commits(signed, signedVelocity, commit, flick), page)
                        }
                    }
                    PageDrag.Pull -> gestures.finishPull(page)
                    PageDrag.Undecided -> Unit
                }
            }
        }
    }
}

internal fun Modifier.swipePagePose(gestures: PageGestures): Modifier = graphicsLayer {
    val direction = gestures.direction
    val progress = gestures.progress.value
    translationX = when (direction) {
        SwipeDirection.Back -> size.width * progress
        SwipeDirection.Forward -> -size.width * SwipeNavigationRules.PARALLAX * progress
        null -> 0f
    }
    translationY = gestures.pull * density
}.drawWithContent {
    drawContent()
    if (gestures.direction == SwipeDirection.Forward) drawRect(Color.Black, alpha = SwipeNavigationRules.SHADE * gestures.progress.value)
}

@Composable
internal fun SwipeTarget(gestures: PageGestures, color: Color, aboveBack: Boolean) {
    val direction = gestures.direction ?: return
    if ((direction == SwipeDirection.Forward) != aboveBack) return
    Box(
        Modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
            .graphicsLayer {
                val progress = gestures.progress.value
                translationX = when (direction) {
                    SwipeDirection.Back -> -size.width * SwipeNavigationRules.PARALLAX * (1f - progress)
                    SwipeDirection.Forward -> size.width * (1f - progress)
                }
                alpha = gestures.targetAlpha.value
                shadowElevation = if (direction == SwipeDirection.Forward && progress < 1f) 12.dp.toPx() else 0f
            }
            .background(color)
            .drawWithContent {
                drawContent()
                if (direction == SwipeDirection.Back) drawRect(Color.Black, alpha = SwipeNavigationRules.SHADE * (1f - gestures.progress.value))
            },
    )
}

@Composable
internal fun RefreshIndicator(gestures: PageGestures, modifier: Modifier = Modifier) {
    val pull = gestures.pull
    if (pull <= 0.5f && !gestures.isRefreshing) return
    val label = stringResource(R.string.browsing_reloading)
    Box(
        modifier
            .offset { IntOffset(0, ((pull - PageGestures.REFRESH_HOLD_DP) / 2f * density + 8.dp.toPx()).roundToInt()) }
            .size(28.dp)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        if (gestures.isRefreshing) {
            CircularProgressIndicator(Modifier.size(22.dp), color = BrowsePalette.loadingBorder.current, strokeWidth = 2.dp)
        } else {
            Icon(
                ArdiaSymbols.arrowClockwise,
                null,
                Modifier.size(20.dp).graphicsLayer {
                    rotationZ = (gestures.pull / PullToRefreshRules.TRIGGER_DP).coerceIn(0f, 1f) * 300f
                    alpha = (gestures.pull / PullToRefreshRules.TRIGGER_DP).coerceIn(0.2f, 1f)
                },
                tint = BrowsePalette.loadingBorder.current,
            )
        }
    }
}

@Composable
internal fun PageContent(
    tab: BrowserTab,
    page: Page?,
    cover: Bitmap?,
    loadFreeze: Boolean,
    swipeMode: SwipeNavigationMode,
    gesturesEnabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val surface = ArdiaThemeState.look.surface.current
    val scope = rememberCoroutineScope()
    val gestures = remember(tab.id) { PageGestures(scope) }
    val view = LocalView.current
    Box(modifier.testTag(BrowsingTags.PAGE)) {
        if (page != null) {
            val background by page.select { it.backgroundColor }
            val targetColor = background?.let { Color(it) } ?: surface
            SwipeTarget(gestures, targetColor, aboveBack = false)
            Box(
                Modifier
                    .fillMaxSize()
                    .swipePagePose(gestures)
                    .pageGestures(gestures, page, swipeMode, gesturesEnabled) { view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK) },
            ) {
                PageSurface(page, Modifier.fillMaxSize(), backdrop = surface)
                PageCover(tab, page, cover, surface)
            }
            SwipeTarget(gestures, targetColor, aboveBack = true)
            RefreshIndicator(gestures, Modifier.align(Alignment.TopCenter))
            val failure by page.select { it.failure }
            failure?.let { PageFailureView(it, onRetry = page::reload) }
        } else {
            PageCover(tab, null, cover, surface)
        }
        if (loadFreeze) {
            PageLoadingPlaceholder(
                title = tab.title,
                url = tab.url,
                backdrop = surface,
                faviconUrl = tab.faviconUrl,
                themeColorHex = tab.themeColorHex,
                revealDelayMillis = Motion.placeholderDelayMillis,
            )
        }
    }
}

@Composable
private fun PageCover(tab: BrowserTab, page: Page?, cover: Bitmap?, surface: Color) {
    val initiallyNeeded = remember(tab.id) {
        val state = page?.state?.value
        val settled = state != null && state.isLive && !state.isLoading && page.view.value != null
        !(settled && cover == null)
    }
    val alpha = remember(tab.id) { Animatable(if (initiallyNeeded) 1f else 0f) }
    LaunchedEffect(tab.id, page) {
        if (page == null || alpha.value == 0f) return@LaunchedEffect
        withTimeoutOrNull(PAINT_DEADLINE_MILLIS) {
            page.view.first { it != null }
            val state = page.state.value
            if (state.isLoading) {
                page.state.first { !it.isLoading }
            } else {
                delay(REATTACH_SETTLE_MILLIS)
            }
        }
        alpha.animateTo(0f, tween(180))
    }
    if (alpha.value <= 0f) return
    Box(Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha.value }.clearAndSetSemantics {}) {
        if (cover != null) {
            val bitmap = remember(cover) { cover.asImageBitmap() }
            Image(bitmap, null, Modifier.fillMaxSize().background(surface), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
        } else {
            PageLoadingPlaceholder(
                title = tab.title,
                url = tab.url,
                backdrop = surface,
                faviconUrl = tab.faviconUrl,
                themeColorHex = tab.themeColorHex,
                revealDelayMillis = Motion.placeholderDelayMillis,
            )
        }
    }
}

private const val PAINT_DEADLINE_MILLIS = 4_000L
private const val REATTACH_SETTLE_MILLIS = 150L

@Composable
internal fun PageFailureView(failure: PageLoadFailure, onRetry: () -> Unit) {
    val context = LocalContext.current
    val surface = ArdiaThemeState.look.surface.current
    val retry by rememberUpdatedState(onRetry)
    if (failure.retriesWhenOnline) RetryWhenOnline(context) { retry() }
    val icon = when {
        failure is PageLoadFailure.Crashed -> BrowsingSymbols.exclamationTriangle
        failure is PageLoadFailure.Network && failure.reason == NetworkFailure.Offline -> BrowsingSymbols.wifiSlash
        else -> ArdiaSymbols.globe
    }
    Column(
        Modifier
            .testTag(BrowsingTags.FAILURE)
            .fillMaxSize()
            .background(surface)
            .padding(horizontal = Spacing.section),
        verticalArrangement = Arrangement.spacedBy(Spacing.tight, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, Modifier.padding(bottom = Spacing.hairline).size(36.dp), tint = SystemPalette.secondaryLabel.current)
        Text(
            failure.title(context),
            style = ArdiaType.title3.semibold,
            color = SystemPalette.label.current,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 320.dp),
        )
        Text(
            failure.message(context),
            style = ArdiaType.subheadline,
            color = SystemPalette.secondaryLabel.current,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 320.dp),
        )
        OutlinedButton(onClick = onRetry, shape = CircleShape, modifier = Modifier.padding(top = Spacing.small)) {
            Text(stringResource(R.string.browsing_try_again), style = ArdiaType.body)
        }
    }
}

@Composable
private fun RetryWhenOnline(context: Context, onOnline: () -> Unit) {
    val callback by rememberUpdatedState(onOnline)
    val view: View = LocalView.current
    DisposableEffect(context) {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        var sawOffline = connectivity?.activeNetwork == null
        val listener = object : ConnectivityManager.NetworkCallback() {
            override fun onLost(network: Network) {
                sawOffline = true
            }

            override fun onAvailable(network: Network) {
                if (!sawOffline) return
                sawOffline = false
                view.post { callback() }
            }
        }
        runCatching { connectivity?.registerDefaultNetworkCallback(listener) }
        onDispose { runCatching { connectivity?.unregisterNetworkCallback(listener) } }
    }
}
