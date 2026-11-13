package com.ardia.search

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import com.ardia.appmodel.AppModel
import com.ardia.design.ArdiaSymbols
import com.ardia.design.BrowseLayout
import com.ardia.design.BrowsePalette
import com.ardia.design.FidgetLogo
import com.ardia.design.FrostedBackdrop
import com.ardia.design.FrostedStyle
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.design.ProfileBackdrop
import com.ardia.design.ProfileLook
import com.ardia.design.SystemPalette
import com.ardia.design.TabsDeckGeometry
import com.ardia.design.TabsLayout
import com.ardia.design.frosted
import com.ardia.design.frostedBackdropSource
import com.ardia.design.rememberFrostedBackdrop

@Composable
fun SearchHomeView(model: AppModel, modifier: Modifier = Modifier) {
    val isTrayUp = model.browse.search != null
    val isIncognito = model.isIncognito
    val reduceMotion = LocalReduceMotion.current
    val shown = animateFloatAsState(
        targetValue = if (isTrayUp) 0f else 1f,
        animationSpec = (if (reduceMotion) Motion.reducedFade else Motion.searchRise).spec(),
        label = "restingStart",
    )
    val isOnboarding = model.settings.isShowingOnboarding
    LaunchedEffect(isOnboarding) {
        model.refreshRecents()
        if (!isOnboarding) model.openTrayIfWanted()
    }
    val dark = LocalArdiaDarkTheme.current || isIncognito
    CompositionLocalProvider(LocalArdiaDarkTheme provides dark) {
        val frost = rememberFrostedBackdrop()
        Box(modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().frostedBackdropSource(frost)) {
                if (isIncognito) {
                    ProfileBackdrop(Modifier.fillMaxSize(), look = ProfileLook.incognito)
                } else {
                    ProfileBackdrop(Modifier.fillMaxSize(), themed = true)
                }
            }
            val hidden = if (isTrayUp) Modifier.clearAndSetSemantics {} else Modifier
            FidgetLogo(
                Modifier
                    .align(Alignment.Center)
                    .padding(bottom = (TabsDeckGeometry.BAR_RESERVE * 0.5).dp)
                    .size(BrowseLayout.logoSize, BrowseLayout.logoSize * 0.82f)
                    .graphicsLayer {
                        alpha = shown.value
                        val scale = if (reduceMotion) 1f else 0.92f + 0.08f * shown.value
                        scaleX = scale
                        scaleY = scale
                    }
                    .then(hidden),
            )
            DeckBar(
                model = model,
                frost = frost,
                enabled = !isTrayUp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .graphicsLayer { alpha = shown.value }
                    .then(hidden),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DeckBar(model: AppModel, frost: FrostedBackdrop, enabled: Boolean, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val navigationBottom = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() }
    val safe = WindowInsets.safeDrawing
    val safeSide = with(density) { maxOf(safe.getLeft(this, direction), safe.getRight(this, direction)).toDp() }
    val centerFromBottom = max(navigationBottom, 20.dp) + 6.dp
    val side = safeSide + TabsLayout.barSideInset - (BrowseLayout.hitTarget - TabsLayout.barCircle) / 2
    val opensTabs = model.deckTabs.isNotEmpty()
    val syncs = model.syncState.isEnabled
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = side)
            .padding(bottom = centerFromBottom - BrowseLayout.hitTarget / 2)
            .height(BrowseLayout.hitTarget),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DeckCircleButton(
            symbol = when {
                opensTabs -> ArdiaSymbols.squareOnSquare
                syncs -> ArdiaSymbols.laptopcomputer
                else -> ArdiaSymbols.archivebox
            },
            label = stringResource(
                when {
                    opensTabs -> R.string.deck_tabs
                    syncs -> R.string.deck_synced_tabs
                    else -> R.string.deck_archive
                },
            ),
            frost = frost,
            enabled = enabled,
        ) {
            when {
                opensTabs -> model.showTabSwitcher()
                syncs -> model.openSyncedSpaces()
                else -> model.openArchive()
            }
        }
        Spacer(Modifier.weight(1f))
        PlusButton(model, frost, enabled)
        Spacer(Modifier.weight(1f))
        DeckCircleButton(ArdiaSymbols.gearshape, stringResource(R.string.deck_settings), frost, enabled) {
            model.sheet = AppModel.Sheet.Settings
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PlusButton(model: AppModel, frost: FrostedBackdrop, enabled: Boolean) {
    var menuOpen by remember { mutableStateOf(false) }
    val isIncognito = model.isIncognito
    val label = stringResource(if (isIncognito) R.string.deck_new_incognito_tab else R.string.deck_new_tab)
    val hint = stringResource(R.string.deck_more_options)
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(50)
    Box(Modifier.height(BrowseLayout.hitTarget), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(TabsLayout.barPlus.width, TabsLayout.barPlus.height)
                .frosted(frost, shape, FrostedStyle.glass)
                .combinedClickable(
                    interactionSource = interaction,
                    indication = null,
                    enabled = enabled,
                    onLongClick = { menuOpen = true },
                    onClick = { model.newTab() },
                )
                .clearAndSetSemantics {
                    contentDescription = label
                    role = Role.Button
                    onClick {
                        model.newTab()
                        true
                    }
                    onLongClick(hint) {
                        menuOpen = true
                        true
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(ArdiaSymbols.plus, null, Modifier.size(20.dp), tint = SystemPalette.label.current)
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            val canReopen = model.tabs.canReopenClosed
            if (isIncognito) {
                MenuItem(stringResource(R.string.deck_new_tab), ArdiaSymbols.plus) {
                    menuOpen = false
                    model.newRegularTab()
                }
                MenuItem(stringResource(R.string.deck_new_incognito_tab), ArdiaSymbols.eyes) {
                    menuOpen = false
                    model.newTab()
                }
            } else {
                MenuItem(stringResource(R.string.deck_new_incognito_tab), ArdiaSymbols.eyes) {
                    menuOpen = false
                    model.newIncognitoTab()
                }
                if (canReopen) {
                    MenuItem(stringResource(R.string.deck_reopen_closed_tab), ArdiaSymbols.arrowUturnBackward) {
                        menuOpen = false
                        model.reopenLastClosed()
                    }
                }
            }
        }
    }
}

@Composable
private fun MenuItem(label: String, icon: ImageVector, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null, Modifier.size(18.dp)) }, onClick = onClick)
}

@Composable
private fun DeckCircleButton(symbol: ImageVector, label: String, frost: FrostedBackdrop, enabled: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        Modifier
            .size(BrowseLayout.hitTarget)
            .combinedClickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onClick)
            .semantics {
                contentDescription = label
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(TabsLayout.barCircle).frosted(frost, CircleShape, FrostedStyle.glass), contentAlignment = Alignment.Center) {
            Icon(symbol, null, Modifier.size(DECK_SYMBOL), tint = BrowsePalette.foregroundSecondary.current)
        }
    }
}

private val DECK_SYMBOL: Dp = 17.dp
