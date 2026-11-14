package com.ardia.settings

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.SettingsRoute
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Stable
class SettingsNav(
    val model: AppModel,
    val stack: SettingsBackStack,
    val connect: SyncConnectSession,
    val close: () -> Unit,
    val closesAtRoot: Boolean = false,
) {
    fun push(route: SettingsRoute) = stack.push(route)

    fun push(destination: SettingsDestination) = stack.push(destination)

    fun pop() {
        if (!stack.pop()) close()
    }
}

@Composable
fun SettingsView(model: AppModel, modifier: Modifier = Modifier) {
    val stack = remember { SettingsBackStack() }
    val connect = remember(model) { SyncConnectSession(model) }
    val nav = remember(model, stack, connect) { SettingsNav(model, stack, connect, close = { model.sheet = null }) }
    val pending = model.settings.pendingRoute
    LaunchedEffect(pending) {
        if (stack.takePending(pending)) model.settings.pendingRoute = null
    }
    SettingsNavHost(nav, modifier.testTag(SettingsTags.ROOT)) { SettingsRootPage(nav) }
}

@Composable
fun SettingsNavHost(nav: SettingsNav, modifier: Modifier = Modifier, root: @Composable () -> Unit) {
    val stack = nav.stack
    val holder = rememberSaveableStateHolder()
    val reduceMotion = LocalReduceMotion.current
    val scope = rememberCoroutineScope()
    val backProgress = remember { Animatable(0f) }
    var gestureDepth by remember { mutableIntStateOf(-1) }
    val entries = stack.entries
    val keys = entries.mapIndexed { index, destination -> "$index:${destination.key}" }
    val savedKeys = remember { HashSet<String>() }

    LaunchedEffect(keys) {
        for (gone in savedKeys - keys.toSet()) holder.removeState(gone)
        savedKeys.clear()
        savedKeys.addAll(keys)
    }

    PredictiveBackHandler(enabled = !stack.isAtRoot) { events ->
        gestureDepth = stack.entries.size
        try {
            events.collect { event -> backProgress.snapTo(event.progress) }
            stack.pop()
            delay(SETTLE_MILLIS)
            backProgress.snapTo(0f)
            gestureDepth = -1
        } catch (cancelled: CancellationException) {
            scope.launch {
                backProgress.animateTo(0f, Motion.snappy.spec())
                gestureDepth = -1
            }
            throw cancelled
        }
    }
    BackHandler(enabled = stack.isAtRoot) { nav.close() }

    Box(modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = entries.size to entries.lastOrNull(),
            transitionSpec = { settingsTransition(forward = targetState.first > initialState.first, reduceMotion) },
            contentKey = { (depth, destination) -> "$depth:${destination?.key}" },
            label = "settingsStack",
        ) { (depth, destination) ->
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        if (depth == gestureDepth) {
                            val progress = backProgress.value
                            val scale = 1f - 0.1f * progress
                            scaleX = scale
                            scaleY = scale
                            transformOrigin = TransformOrigin(0f, 0.5f)
                            translationX = size.width * 0.04f * progress
                        }
                    },
            ) {
                if (destination == null) {
                    holder.SaveableStateProvider(ROOT_KEY) { root() }
                } else {
                    holder.SaveableStateProvider("${depth - 1}:${destination.key}") { SettingsDestinationPage(nav, destination) }
                }
            }
        }
    }
}

private const val ROOT_KEY = "root"
private const val SETTLE_MILLIS = 500L

private fun settingsTransition(forward: Boolean, reduceMotion: Boolean): ContentTransform {
    if (reduceMotion) return fadeIn(Motion.reducedFade.spec()) togetherWith fadeOut(Motion.reducedFade.spec())
    val spec = Motion.smooth.spec<IntOffset>(IntOffset.VisibilityThreshold)
    return if (forward) {
        slideInHorizontally(spec) { it } togetherWith slideOutHorizontally(spec) { -it / 3 }
    } else {
        slideInHorizontally(spec) { -it / 3 } togetherWith slideOutHorizontally(spec) { it }
    }
}

@Composable
fun SettingsDestinationPage(nav: SettingsNav, destination: SettingsDestination) {
    when (destination) {
        is SettingsDestination.FilterList -> FilterListDetailPage(nav, destination.id)
        SettingsDestination.EnterWords -> RecoveryPhraseEntryPage(nav)
        is SettingsDestination.Page -> when (destination.route) {
            SettingsRoute.Sync -> SyncSettingsPage(nav)
            SettingsRoute.SiteSettings -> SiteSettingsPage(nav)
            SettingsRoute.Connect -> SyncConnectPage(nav, onConnected = nav::pop)
            SettingsRoute.SearchEngine -> SearchEnginePage(nav)
            SettingsRoute.FilterLists -> FilterListsPage(nav)
            SettingsRoute.FilterListDetail -> FilterListDetailPage(nav, SettingsDestination.DEFAULT_FILTER_LIST)
            SettingsRoute.MyFilters -> MyFiltersEditor(nav)
            SettingsRoute.TrustedSites -> TrustedSitesPage(nav)
            SettingsRoute.ClearData -> ClearBrowsingDataPage(nav)
            SettingsRoute.DefaultBrowser -> DefaultBrowserPage(nav)
            SettingsRoute.About -> AboutPage(nav)
            SettingsRoute.Licenses -> LicensesPage(nav)
        }
    }
}
