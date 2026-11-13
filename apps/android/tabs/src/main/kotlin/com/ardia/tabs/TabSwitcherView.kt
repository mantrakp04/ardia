package com.ardia.tabs

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.pageLeft
import androidx.compose.ui.semantics.pageRight
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.ardia.appmodel.AppModel
import com.ardia.design.ArdiaType
import com.ardia.design.BrowseLayout
import com.ardia.design.DeckSize
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LocalProfileLook
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.TabsBackdrop
import com.ardia.design.TabsDeckGeometry
import com.ardia.design.TabsLayout
import com.ardia.design.TabsMotion
import com.ardia.design.frostedBackdropSource
import com.ardia.design.rememberFrostedBackdrop
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlin.math.max
import kotlin.math.roundToInt

@Composable
fun TabSwitcherView(model: AppModel, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val state = remember(model) { DeckState(model, scope, haptics) }
    state.reduceMotion = LocalReduceMotion.current
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val insets = WindowInsets.safeDrawing
    BoxWithConstraints(modifier.fillMaxSize().testTag(DECK_TAG)) {
        val safeTop = insets.getTop(density) / density.density
        val safeBottom = insets.getBottom(density) / density.density
        val safeSide = max(insets.getLeft(density, direction), insets.getRight(density, direction)) / density.density
        val width = maxWidth.value.toDouble()
        val height = maxHeight.value.toDouble()
        val geometry = remember(width, height, safeTop, safeBottom, safeSide) {
            TabsDeckGeometry(DeckSize(width, height), safeTop.toDouble(), safeBottom.toDouble(), safeSide.toDouble())
        }
        SideEffect { state.geometry = geometry }
        TabDeck(model, state, haptics, geometry)
    }
    LaunchedEffect(state) { state.appear() }
    LaunchedEffect(state) {
        snapshotFlow { model.deckTabs.map { it.id } }.distinctUntilChanged().collect { state.reconcile() }
    }
    LaunchedEffect(state) {
        val initial = model.deck.command?.id
        snapshotFlow { model.deck.command }.filterNotNull().distinctUntilChanged().collect { command ->
            if (command.id != initial) state.perform(command.kind)
        }
    }
    BackHandler { state.back() }
}

@Composable
private fun TabDeck(model: AppModel, state: DeckState, haptics: Haptics, geometry: TabsDeckGeometry) {
    val look = LocalProfileLook.current
    val dark = LocalArdiaDarkTheme.current
    val backdrop = rememberFrostedBackdrop()
    val order = state.order
    val range = state.renderedRange
    val tabs = state.tabsById
    val privateCount = model.tabs.privateTabs.size
    Box(
        Modifier
            .fillMaxSize()
            .deckGestures(state)
            .semantics {
                pageLeft {
                    state.settle(DeckOrder.rounded(state.currentScroll.toDouble()) - 1)
                    true
                }
                pageRight {
                    state.settle(DeckOrder.rounded(state.currentScroll.toDouble()) + 1)
                    true
                }
            },
    ) {
        TabsBackdrop(
            Modifier
                .fillMaxSize()
                .frostedBackdropSource(backdrop)
                .graphicsLayer { alpha = state.backdropOpacity },
            look = look,
        )
        for (index in range) {
            val id = order.getOrNull(index) ?: continue
            val tab = tabs[id] ?: continue
            val isLast = index == order.size - 1
            val expanded = state.role(id, index) == DeckRole.Expanded
            key(id) {
                Box(Modifier.zIndex(index * 2f + if (expanded) EXPANDED_LAYER else 0f)) {
                    DeckCardItem(model, state, haptics, tab, index, isLast)
                }
                Box(Modifier.zIndex(index * 2f + 1 + if (expanded) EXPANDED_LAYER else 0f)) {
                    DeckCardHeaderItem(state, tab, index, isLast)
                }
            }
        }
        if (order.isEmpty() && state.phase == DeckPhase.Settled) {
            DeckEmptyState(
                showsArchive = model.hasArchivedTabs,
                openArchive = model::openArchive,
                modifier = Modifier
                    .zIndex(OVERLAY_LAYER)
                    .centeredAt(geometry.cardCenterY)
                    .shieldsDeck(),
            )
        }
        for (spec in state.poofs) {
            key(spec.id) { Box(Modifier.zIndex(OVERLAY_LAYER)) { PoofBurst(spec) } }
        }
        if (privateCount > 0) {
            IncognitoChip(
                count = privateCount,
                close = { state.isConfirmingCloseIncognito = true },
                modifier = Modifier
                    .zIndex(OVERLAY_LAYER)
                    .align(Alignment.TopCenter)
                    .offset(y = geometry.safeTop.dp)
                    .graphicsLayer { alpha = if (state.lifting.isEmpty()) state.chromeOpacity else 0f }
                    .shieldsDeck(),
            )
        }
        AnimatedVisibility(
            visible = state.showsArchiveCard,
            modifier = Modifier
                .zIndex(OVERLAY_LAYER + 1)
                .centeredAt(geometry.barCenterY - ARCHIVE_CARD_RISE)
                .padding(horizontal = Spacing.page)
                .shieldsDeck(),
            enter = fadeIn(TabsMotion.fade.spec()) + if (state.reduceMotion) fadeIn(TabsMotion.fade.spec()) else scaleIn(TabsMotion.fade.spec(), 0.96f),
            exit = fadeOut(TabsMotion.fade.spec()) + if (state.reduceMotion) fadeOut(TabsMotion.fade.spec()) else scaleOut(TabsMotion.fade.spec(), 0.96f),
        ) {
            ArchiveIntervalCard(
                interval = model.autoArchiveInterval,
                choose = { model.autoArchiveInterval = it },
                dismiss = state::hideArchiveCard,
            )
        }
        TabDeckBar(
            backdrop = backdrop,
            look = look,
            isIncognito = model.isIncognito,
            showsSyncedTabs = model.syncState.isEnabled,
            canReopen = model.tabs.canReopenClosed,
            hasTabs = order.isNotEmpty(),
            actions = remember(model, state) {
                DeckBarActions(
                    newTab = model::newTab,
                    newRegularTab = model::newRegularTab,
                    newIncognitoTab = model::newIncognitoTab,
                    reopen = model::reopenLastClosed,
                    closeAll = { state.isConfirmingCloseAll = true },
                    leading = { if (model.syncState.isEnabled) model.openSyncedSpaces() else model.openArchive() },
                    settings = { model.sheet = AppModel.Sheet.Settings },
                )
            },
            modifier = Modifier
                .zIndex(OVERLAY_LAYER + 2)
                .centeredAt(geometry.barCenterY)
                .shieldsDeck()
                .padding(horizontal = (geometry.safeSide + BAR_SIDE_PADDING).dp)
                .graphicsLayer { alpha = state.chromeOpacity },
        )
        val cover = state.cover
        if (cover != null) {
            Image(
                cover,
                contentDescription = null,
                modifier = Modifier
                    .zIndex(OVERLAY_LAYER + 3)
                    .fillMaxSize()
                    .clearAndSetSemantics {}
                    .background(SystemPalette.background.resolve(dark))
                    .graphicsLayer { alpha = state.coverOpacity.value },
                contentScale = ContentScale.FillWidth,
                alignment = Alignment.TopCenter,
            )
        }
    }
    DeckDialogs(model, state, haptics, order.size)
}

@Composable
private fun DeckDialogs(model: AppModel, state: DeckState, haptics: Haptics, count: Int) {
    val dark = LocalArdiaDarkTheme.current
    val destructive = SystemPalette.red.resolve(dark)
    if (state.isConfirmingCloseAll) {
        val hasPrivate = model.tabs.privateTabs.isNotEmpty()
        AlertDialog(
            onDismissRequest = { state.isConfirmingCloseAll = false },
            title = { Text(pluralStringResource(R.plurals.tabs_close_count_title, count, count), style = ArdiaType.headline) },
            text = { Text(stringResource(if (hasPrivate) R.string.tabs_close_all_message_incognito else R.string.tabs_close_all_message)) },
            confirmButton = {
                TextButton(onClick = {
                    state.isConfirmingCloseAll = false
                    haptics.mediumImpact()
                    state.closeAll()
                }) {
                    Text(stringResource(if (count == 1) R.string.tabs_close_tab else R.string.tabs_close_all_tabs), color = destructive)
                }
            },
            dismissButton = { TextButton(onClick = { state.isConfirmingCloseAll = false }) { Text(stringResource(R.string.tabs_cancel)) } },
        )
    }
    if (state.isConfirmingCloseIncognito) {
        AlertDialog(
            onDismissRequest = { state.isConfirmingCloseIncognito = false },
            title = { Text(stringResource(R.string.tabs_close_incognito_title), style = ArdiaType.headline) },
            text = { Text(stringResource(R.string.tabs_close_incognito_message)) },
            confirmButton = {
                TextButton(onClick = {
                    state.isConfirmingCloseIncognito = false
                    haptics.mediumImpact()
                    state.leaveIncognito()
                }) {
                    Text(stringResource(R.string.tabs_close_incognito_tabs), color = destructive)
                }
            },
            dismissButton = { TextButton(onClick = { state.isConfirmingCloseIncognito = false }) { Text(stringResource(R.string.tabs_cancel)) } },
        )
    }
}

const val DECK_TAG = "tabs.deck"
private const val EXPANDED_LAYER = 100_000f
private const val OVERLAY_LAYER = 1_000_000f
private const val ARCHIVE_CARD_RISE = 76.0
private val BAR_SIDE_PADDING = TabsLayout.barSideInset.value - (BrowseLayout.hitTarget.value - TabsLayout.barCircle.value) / 2

private fun Modifier.centeredAt(centerY: Double): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
    layout(constraints.maxWidth, constraints.maxHeight) {
        placeable.place((constraints.maxWidth - placeable.width) / 2, (centerY * density - placeable.height / 2.0).roundToInt())
    }
}
