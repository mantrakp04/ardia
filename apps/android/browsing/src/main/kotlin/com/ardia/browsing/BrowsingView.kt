package com.ardia.browsing

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.PagerModel
import com.ardia.browser.FullscreenVideo
import com.ardia.browser.PageColors
import com.ardia.browser.ScrollDirection
import com.ardia.design.ArdiaThemeState
import com.ardia.design.BrowseLayout
import com.ardia.design.LoadingLine
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.store.BrowserTab
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlin.math.roundToInt

@Composable
fun BrowsingView(model: AppModel, isFront: Boolean, modifier: Modifier = Modifier) {
    val tab = model.tabs.selectedTab
    val page = tab?.let { model.page(it.id) }
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val density = LocalDensity.current
    val reduceMotion = LocalReduceMotion.current
    val dark = LocalArdiaDarkTheme.current
    val surface = ArdiaThemeState.look.surface.current
    val pager = remember(model) { TabPager(model, PagerModel(), scope) { view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) } }
    pager.reduceMotion = reduceMotion
    val corner = rememberDisplayCornerRadius()
    var barHidden by remember { mutableStateOf(false) }
    var showsSiteSettings by remember { mutableStateOf(false) }
    val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val navigationBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val barHeight = BarGeometry.height(navigationBottom)
    val collapses = model.settings.collapsesBottomBar
    val pageBottomInset = if (collapses) 0.dp else BarGeometry.pageBottomInset(navigationBottom)
    val colors = page?.select { it.themeColor to it.backgroundColor }?.value
    val tone = tab?.let { model.tone(it, colors?.first, colors?.second) }
    val isFinding = model.browse.isFindPresented && page != null && isFront
    val readerId = model.browse.readerTabId
    val press = model.browse.press?.takeIf { it.tabId == tab?.id }
    val fullscreen = page?.fullscreen?.collectAsState()?.value
    val canGoBack = page?.select { it.canGoBack }?.value ?: false
    val menuVisible = model.browse.isToolbarPresented && tab != null && isFront
    val loadFreeze = model.launch.loadFreeze

    fun openDeck() {
        model.browse.thawOrder()
        model.showTabSwitcher()
    }

    fun switchTab(id: String) {
        val order = model.swipeOrder
        pager.cancel()
        model.browse.freezeOrder(order.map { it.id })
        model.openTab(id)
    }

    fun stepTab(delta: Int) {
        SwipeOrder.neighbor(model.swipeOrder, model.tabs.selectedTabId, delta)?.let { switchTab(it.id) }
    }

    LaunchedEffect(tab?.id) {
        barHidden = false
        model.goBackToSearchIfEmpty()
        tab?.id?.let(model::prepareToOpen)
        pager.warmNeighbors()
        if (model.browse.isFindPresented) model.endFindOnPage()
    }
    LaunchedEffect(isFront) {
        if (isFront) barHidden = false else if (model.browse.isFindPresented) model.endFindOnPage()
    }
    LaunchedEffect(model.browse.deckRequested) {
        if (!model.browse.deckRequested) return@LaunchedEffect
        model.browse.deckRequested = false
        openDeck()
    }
    val step = model.browse.stepRequest
    LaunchedEffect(step) {
        step ?: return@LaunchedEffect
        model.browse.stepRequest = null
        stepTab(step.delta)
    }
    LaunchedEffect(page, collapses) {
        page ?: return@LaunchedEffect
        page.state.map { it.scrollDirection }.distinctUntilChanged().collect { direction ->
            barHidden = collapses && direction == ScrollDirection.Down
        }
    }
    val toneBottomInset = with(density) { (if (collapses) barHeight else BarGeometry.PAGE_OVERLAP).toPx().roundToInt() }
    LaunchedEffect(page, isFront, toneBottomInset) {
        if (page == null || !isFront) return@LaunchedEffect
        page.state.map { Triple(it.isLoading, it.scrollDirection, it.isScrolledToTop) }.distinctUntilChanged().collectLatest { (loading, _, _) ->
            if (loading) return@collectLatest
            delay(TONE_SETTLE_MILLIS)
            val sampled = page.sampleTone(0, toneBottomInset) ?: return@collectLatest
            model.browse.setTone(sampled, page.id)
        }
    }
    DemoMotion(model, pager)
    val readerSettings = rememberReaderSettings()
    val pageDarkIcons = !(tone?.top?.let(PageColors::isDark) ?: dark)
    val readerDarkIcons = ReaderTheme.resolve(readerSettings.theme, dark).usesDarkStatusIcons
    StatusBarAppearance(
        enabled = isFront && (model.browse.search == null || readerId != null),
        darkIcons = if (readerId != null) readerDarkIcons else pageDarkIcons,
    )

    fun liveBackState(): BackState {
        val livePage = model.currentPage
        val liveMenu = model.browse.isToolbarPresented && model.tabs.selectedTab != null && isFront
        return BackState(
            isFullscreen = livePage?.fullscreen?.value != null,
            hasPressMenu = model.browse.press?.let { it.tabId == model.tabs.selectedTabId } == true,
            isFinding = model.browse.isFindPresented && livePage != null && isFront,
            isReading = model.browse.readerTabId != null,
            isOnSubPage = liveMenu && showsSiteSettings,
            isSheetOpen = liveMenu,
            canGoBack = livePage?.state?.value?.canGoBack == true,
            hasTab = model.tabs.selectedTab != null,
        )
    }
    val composedBackTarget = BackOrder.next(
        BackState(fullscreen != null, press != null, isFinding, readerId != null, menuVisible && showsSiteSettings, menuVisible, canGoBack, tab != null),
    )
    BackHandler(enabled = isFront && composedBackTarget != null && model.browse.search == null) {
        val livePage = model.currentPage
        when (BackOrder.next(liveBackState())) {
            BrowsingLayer.FullscreenVideo -> livePage?.fullscreen?.value?.exit()
            BrowsingLayer.PressMenu -> model.browse.press = null
            BrowsingLayer.FindBar -> model.endFindOnPage()
            BrowsingLayer.Reader -> model.browse.readerTabId = null
            BrowsingLayer.SubPage -> showsSiteSettings = false
            BrowsingLayer.Sheet -> model.browse.isToolbarPresented = false
            BrowsingLayer.PageHistory -> livePage?.goBack()
            BrowsingLayer.TabSwitcher -> openDeck()
            null -> Unit
        }
    }

    BoxWithConstraints(
        modifier
            .fillMaxSize()
            .background(if (pager.isActive) Color.Black else surface)
            .then(if (isFront) Modifier else Modifier.clearAndSetSemantics {}),
    ) {
        pager.widthDp = maxWidth.value
        if (tab != null) {
            val statusColor by animateColorAsState(tone?.topColor() ?: surface, tween(250), label = "statusTone")
            Column(Modifier.fillMaxSize().outgoingPagerPose(pager, corner).background(surface)) {
                Box(Modifier.fillMaxWidth().height(statusTop).background(statusColor))
                Box(Modifier.fillMaxWidth().weight(1f).padding(bottom = pageBottomInset)) {
                    PageContent(
                        tab = tab,
                        page = page,
                        cover = rememberCover(model, pager, tab),
                        loadFreeze = loadFreeze != null,
                        swipeMode = model.browsing.swipeNavigation,
                        gesturesEnabled = isFront && !pager.isActive,
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (press != null && isFront) PagePressMenu(model, press)
                }
            }
            PagerNeighbors(model, pager, statusTop, corner)
        }
        if (page != null) {
            val progress by page.select { it.progress }
            val loading by page.select { it.isLoading }
            LoadingLine(
                progress = loadFreeze ?: progress.toDouble(),
                isLoading = loadFreeze != null || loading,
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding(),
            )
        }
        Bar(
            model = model,
            pager = pager,
            tone = tone?.bottom,
            hidden = barHidden || isFinding,
            height = barHeight,
            navigationBottom = navigationBottom,
            reduceMotion = reduceMotion,
            onTabs = ::openDeck,
            onStep = ::stepTab,
            onSelectTab = ::switchTab,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
        page?.takeIf { isFinding }?.let { FindBar(it, onDone = model::endFindOnPage, modifier = Modifier.align(Alignment.BottomCenter)) }
        if (fullscreen != null) FullscreenVideoLayer(fullscreen)
        if (tab != null) {
            LaunchedEffect(menuVisible) { if (menuVisible) showsSiteSettings = false }
            BrowsingSheet(visible = menuVisible, onDismiss = { model.browse.isToolbarPresented = false }, tag = BrowsingTags.MENU) {
                PageMenu(
                    model = model,
                    tab = tab,
                    page = page,
                    showsSiteSettings = showsSiteSettings,
                    onShowSiteSettings = { showsSiteSettings = it },
                    onDismiss = { model.browse.isToolbarPresented = false },
                )
            }
        }
        ReaderLayer(model, readerId, readerSettings)
        if (isFront) PageRequestHost(page)
    }
}

private const val TONE_SETTLE_MILLIS = 250L

@Composable
private fun Bar(
    model: AppModel,
    pager: TabPager,
    tone: Int?,
    hidden: Boolean,
    height: androidx.compose.ui.unit.Dp,
    navigationBottom: androidx.compose.ui.unit.Dp,
    reduceMotion: Boolean,
    onTabs: () -> Unit,
    onStep: (Int) -> Unit,
    onSelectTab: (String) -> Unit,
    modifier: Modifier,
) {
    val hide by animateFloatAsState(
        targetValue = if (hidden) 1f else 0f,
        animationSpec = if (reduceMotion) tween(200) else Motion.barCollapse.spec(),
        label = "barCollapse",
    )
    val gone by remember { derivedStateOf { hide > 0.99f } }
    val travel = with(LocalDensity.current) { BrowseLayout.barCollapseTravel.toPx() }
    val barDark = tone?.let(PageColors::isDark) ?: LocalArdiaDarkTheme.current
    Box(
        modifier
            .testTag(BrowsingTags.BAR)
            .fillMaxWidth()
            .height(height)
            .graphicsLayer {
                translationY = hide * travel
                alpha = 1f - hide
            }
            .barBacking(tone)
            .tabPagerDrag(pager, enabled = !hidden),
    ) {
        if (!(hidden && gone)) {
            CompositionLocalProvider(LocalArdiaDarkTheme provides barDark) {
                BottomBar(
                    model = model,
                    isSearchPresented = model.browse.search != null,
                    onTabs = onTabs,
                    onPlus = model::newTab,
                    onMore = { model.browse.isToolbarPresented = true },
                    onStep = onStep,
                    onSelectTab = onSelectTab,
                    onCloseTab = { model.tabs.selectedTabId?.let(model::closeTab) },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = BarGeometry.centerFromBottom(navigationBottom) - BrowseLayout.hitTarget / 2)
                        .height(BrowseLayout.hitTarget),
                )
            }
        }
    }
}

@Composable
private fun rememberCover(model: AppModel, pager: TabPager, tab: BrowserTab): Bitmap? {
    val immediate = remember(tab.id) { pager.cover(tab) }
    var stored by remember(tab.id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(tab.id) {
        if (immediate == null && tab.snapshotFileName != null) stored = model.snapshotImage(tab)
    }
    return immediate ?: stored
}

@Composable
private fun ReaderLayer(model: AppModel, readerId: String?, settings: ReaderSettings) {
    var shownId by remember { mutableStateOf(readerId) }
    if (readerId != null) shownId = readerId
    AnimatedVisibility(
        visible = readerId != null,
        enter = slideInVertically(Motion.searchRise.spec()) { it },
        exit = slideOutVertically(Motion.trayDismiss.spec()) { it },
    ) {
        val id = shownId ?: return@AnimatedVisibility
        ReaderView(model.page(id), settings, onDone = { model.browse.readerTabId = null })
    }
}

@Composable
private fun FullscreenVideoLayer(video: FullscreenVideo) {
    val context = LocalContext.current
    DisposableEffect(video) {
        val window = context.findActivity()?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, it.decorView) }
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose { controller?.show(WindowInsetsCompat.Type.systemBars()) }
    }
    AndroidView(
        factory = { FrameLayout(it).apply { setBackgroundColor(android.graphics.Color.BLACK) } },
        update = { container ->
            if (video.view.parent !== container) {
                (video.view.parent as? ViewGroup)?.removeView(video.view)
                container.removeAllViews()
                container.addView(video.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            }
        },
        onRelease = { it.removeAllViews() },
        modifier = Modifier.fillMaxSize().background(Color.Black),
    )
}

@Composable
internal fun StatusBarAppearance(enabled: Boolean, darkIcons: Boolean) {
    val context = LocalContext.current
    val view = LocalView.current
    val wanted by rememberUpdatedState(darkIcons)
    DisposableEffect(enabled, darkIcons) {
        val window = context.findActivity()?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val previous = controller?.isAppearanceLightStatusBars
        if (enabled) controller?.isAppearanceLightStatusBars = wanted
        onDispose { if (enabled && previous != null) controller.isAppearanceLightStatusBars = previous }
    }
}

internal fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}

@Composable
private fun DemoMotion(model: AppModel, pager: TabPager) {
    val launch = model.launch
    LaunchedEffect(Unit) {
        val fraction = launch.pagerFreeze ?: return@LaunchedEffect
        delay(launch.browseDelayMillis)
        if (!pager.grab()) return@LaunchedEffect
        pager.track((-fraction * pager.widthDp).toFloat())
        pager.pager.isTracking = false
    }
    LaunchedEffect(Unit) {
        if (!launch.pagerScript) return@LaunchedEffect
        delay(launch.browseDelayMillis)
        suspend fun drag(fraction: Float, seconds: Float) {
            val start = PagerPoses.rawOffset(pager.presented, pager.pager.hasLeft, pager.pager.hasRight)
            val steps = maxOf((seconds * 120).toInt(), 1)
            for (index in 1..steps) {
                val t = index.toFloat() / steps
                pager.track(start + (fraction * pager.widthDp - start) * t)
                delay(8)
            }
        }
        fun settle(target: Int, velocity: Float) {
            pager.pager.isTracking = false
            pager.settle(target, velocity)
        }
        if (!pager.grab()) return@LaunchedEffect
        drag(0.25f, 0.3f)
        settle(0, 0f)
        delay(1_200)
        if (!pager.grab()) return@LaunchedEffect
        drag(-0.3f, 0.25f)
        val m = pager.pager
        settle(
            com.ardia.design.PagerPhysics.snapTarget(m.offset.toDouble(), -1400.0, pager.widthDp.toDouble(), m.hasLeft, m.hasRight),
            -1400f,
        )
        delay(1_500)
        if (!pager.grab()) return@LaunchedEffect
        drag(0.3f, 0.25f)
        settle(1, 1400f)
        delay(120)
        if (!pager.grab()) return@LaunchedEffect
        drag(0.1f, 0.2f)
        settle(0, -300f)
    }
}
