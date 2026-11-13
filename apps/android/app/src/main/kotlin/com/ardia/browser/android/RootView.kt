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
fun RootView(model: AppModel) {
    var sheetProgress by remember { mutableFloatStateOf(0f) }
    val backgroundShape = remember { RoundedCornerShape(SheetLayout.backgroundRadius) }
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
                },
        ) {
            Surfaces(model)
            SearchTray(model, Modifier.zIndex(10f))
        }
        SheetHost(
            sheet = model.sheet.takeIf { it != AppModel.Sheet.Onboarding },
            onDismiss = { model.sheet = null },
            onProgress = { sheetProgress = it },
            modifier = Modifier.zIndex(20f),
        ) { sheet -> SheetContent(model, sheet) }
        FullScreenCover(
            visible = model.browse.isVoicePresented,
            onDismissRequest = { model.browse.isVoicePresented = false },
            modifier = Modifier.zIndex(30f).testTag(RootTags.VOICE),
        ) { VoiceSearch(model) }
        OnboardingCover(model, Modifier.zIndex(40f))
        ToastHost(model.toasts, Modifier.zIndex(50f))
    }
    StatusBarInkOwner(model)
}

@Composable
private fun Surfaces(model: AppModel) {
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
    Box(
        Modifier
            .fillMaxSize()
            .then(if (holdsKeyboard) Modifier else Modifier.imePadding())
            .testTag(RootTags.SURFACES),
    ) {
        if (!homeSettled) {
            BrowsingSurface(model, isFront = surface == AppModel.Surface.Browsing, modifier = Modifier.fillMaxSize())
            if (covered == AppModel.Surface.TabSwitcher) TabDeck(model, Modifier.fillMaxSize().zIndex(1f))
        }
        AnimatedVisibility(
            visibleState = home,
            enter = fadeIn(motion.spec()),
            exit = fadeOut(motion.spec()),
            modifier = Modifier.fillMaxSize().zIndex(2f),
        ) {
            SearchStart(model, Modifier.fillMaxSize())
        }
    }
}

private class CoveredSurface {
    var surface: AppModel.Surface = AppModel.Surface.Browsing
}

@Composable
private fun SheetContent(model: AppModel, sheet: AppModel.Sheet) {
    when (sheet) {
        AppModel.Sheet.Settings -> SettingsSheet(model)
        AppModel.Sheet.SyncSetup -> SyncSetupSheet(model)
        AppModel.Sheet.Onboarding -> Unit
        AppModel.Sheet.Archive -> ArchiveSheet(model)
        AppModel.Sheet.SyncedSpaces -> SyncedSpacesSheet(model)
    }
}

@Composable
private fun OnboardingCover(model: AppModel, modifier: Modifier) {
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
    ) { Onboarding(model) }
}
