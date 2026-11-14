package com.ardia.browser.android

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.zIndex
import com.ardia.appmodel.AppModel
import com.ardia.browser.android.system.SystemSnapshotExport
import com.ardia.design.ArdiaTheme
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.design.ToastHost
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first

object RootTags {
    const val ROOT = "ardia.root"
    const val SURFACES = "ardia.surfaces"
    const val SHEET = "ardia.sheet"
    const val VOICE = "ardia.voice"
    const val ONBOARDING = "ardia.onboarding"
}

@Composable
fun ArdiaRoot(model: AppModel, createdAt: Long) {
    ArdiaTheme(darkTheme = isSystemInDarkTheme(), look = model.look) {
        RootView(model)
    }
    LaunchedEffect(model) {
        snapshotFlow { model.isReady }.filter { it }.first()
        StartupTiming.storeReady(createdAt)
    }
    SystemSnapshotExport(model)
}

@Composable
fun RootView(model: AppModel, screens: RootScreens = RootScreens.app) {
    var sheetProgress by remember { mutableFloatStateOf(0f) }
    val backgroundShape = remember { RoundedCornerShape(SheetLayout.backgroundRadius) }
    val sheet = model.sheet.takeIf { it != AppModel.Sheet.Onboarding }
    val onboardingCovers = model.settings.isShowingOnboarding
    val voiceCovers = model.browse.isVoicePresented || onboardingCovers
    val sheetCovers = sheet != null || voiceCovers
    Box(Modifier.fillMaxSize().background(model.look.surface.current).testTag(RootTags.ROOT)) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val progress = sheetProgress
                    val scale = 1f - SheetLayout.BACKGROUND_SHRINK * progress
                    scaleX = scale
                    scaleY = scale
                    clip = progress > 0f
                    shape = backgroundShape
                }
                .coveredFromAccessibility(sheetCovers),
        ) {
            Surfaces(model, screens)
            screens.searchTray(model, Modifier.zIndex(10f))
        }
        SheetHost(
            sheet = sheet,
            onDismiss = { model.sheet = null },
            onProgress = { sheetProgress = it },
            modifier = Modifier.zIndex(20f).coveredFromAccessibility(voiceCovers),
        ) { sheet -> SheetContent(model, sheet, screens) }
        FullScreenCover(
            visible = model.browse.isVoicePresented,
            onDismissRequest = { model.browse.isVoicePresented = false },
            modifier = Modifier.zIndex(30f).coveredFromAccessibility(onboardingCovers).testTag(RootTags.VOICE),
        ) { screens.voiceSearch(model) }
        OnboardingCover(model, screens, Modifier.zIndex(40f))
        ToastHost(model.toasts, Modifier.zIndex(50f))
    }
    StatusBarInkOwner(model)
}

@Composable
private fun Surfaces(model: AppModel, screens: RootScreens) {
    val surface = model.surface
    val isHome = surface == AppModel.Surface.Search
    val reduceMotion = LocalReduceMotion.current
    val motion = if (reduceMotion) Motion.surfaceFade else Motion.surfaceSwap
    val home = remember { MutableTransitionState(isHome) }
    home.targetState = isHome
    val lastCovered = remember { CoveredSurface() }
    if (!isHome) lastCovered.surface = surface
    val covered = lastCovered.surface
    val homeSettled = home.isIdle && home.currentState
    val holdsKeyboard = model.browse.trayHoldsKeyboard
    val trayCovers = model.browse.search != null
    Box(
        Modifier
            .fillMaxSize()
            .then(if (holdsKeyboard) Modifier else Modifier.imePadding())
            .coveredFromAccessibility(trayCovers)
            .testTag(RootTags.SURFACES),
    ) {
        if (!homeSettled) {
            screens.browsing(model, surface == AppModel.Surface.Browsing, Modifier.fillMaxSize().coveredFromAccessibility(surface != AppModel.Surface.Browsing))
            if (covered == AppModel.Surface.TabSwitcher) screens.tabDeck(model, Modifier.fillMaxSize().zIndex(1f).coveredFromAccessibility(isHome))
        }
        AnimatedVisibility(
            visibleState = home,
            enter = fadeIn(motion.spec()),
            exit = fadeOut(motion.spec()),
            modifier = Modifier.fillMaxSize().zIndex(2f).coveredFromAccessibility(!isHome),
        ) {
            screens.searchStart(model, Modifier.fillMaxSize())
        }
    }
}

private class CoveredSurface {
    var surface: AppModel.Surface = AppModel.Surface.Browsing
}

@Composable
private fun SheetContent(model: AppModel, sheet: AppModel.Sheet, screens: RootScreens) {
    when (sheet) {
        AppModel.Sheet.Settings -> screens.settings(model)
        AppModel.Sheet.SyncSetup -> screens.syncSetup(model)
        AppModel.Sheet.Onboarding -> Unit
        AppModel.Sheet.Archive -> screens.archive(model)
        AppModel.Sheet.SyncedSpaces -> screens.syncedSpaces(model)
    }
}

@Composable
private fun OnboardingCover(model: AppModel, screens: RootScreens, modifier: Modifier) {
    val settings = model.settings
    LaunchedEffect(model.sheet) {
        if (model.sheet == AppModel.Sheet.Onboarding) {
            model.sheet = null
            settings.showOnboarding()
        }
    }
    FullScreenCover(
        visible = settings.isShowingOnboarding,
        onDismissRequest = { if (!settings.hasFinishedOnboarding) model.finishOnboarding() else settings.isShowingOnboarding = false },
        modifier = modifier.testTag(RootTags.ONBOARDING),
    ) { screens.onboarding(model) }
}
