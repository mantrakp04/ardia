package com.ardia.tabs

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.BrowseLayout
import com.ardia.design.FrostedBackdrop
import com.ardia.design.FrostedStyle
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LookFrosting
import com.ardia.design.Palette
import com.ardia.design.ProfileLook
import com.ardia.design.SystemPalette
import com.ardia.design.TabsLayout
import com.ardia.design.TabsPalette
import com.ardia.design.frosted
import com.ardia.design.monospacedDigits
import com.ardia.design.semibold

class DeckBarActions(
    val newTab: () -> Unit,
    val newRegularTab: () -> Unit,
    val newIncognitoTab: () -> Unit,
    val reopen: () -> Unit,
    val closeAll: () -> Unit,
    val leading: () -> Unit,
    val settings: () -> Unit,
)

@Composable
internal fun TabDeckBar(
    backdrop: FrostedBackdrop?,
    look: ProfileLook,
    isIncognito: Boolean,
    showsSyncedTabs: Boolean,
    canReopen: Boolean,
    hasTabs: Boolean,
    actions: DeckBarActions,
    modifier: Modifier = Modifier,
) {
    val style = LookFrosting.bar(look)
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        DeckCircleButton(
            symbol = if (showsSyncedTabs) ArdiaSymbols.laptopcomputer else ArdiaSymbols.archivebox,
            label = stringResource(if (showsSyncedTabs) R.string.tabs_synced_tabs else R.string.tabs_archive),
            backdrop = backdrop,
            style = style,
            action = actions.leading,
        )
        Spacer(Modifier.weight(1f))
        PlusButton(backdrop, style, isIncognito, canReopen, hasTabs, actions)
        Spacer(Modifier.weight(1f))
        DeckCircleButton(ArdiaSymbols.gearshape, stringResource(R.string.tabs_settings), backdrop, style, actions.settings)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PlusButton(
    backdrop: FrostedBackdrop?,
    style: FrostedStyle,
    isIncognito: Boolean,
    canReopen: Boolean,
    hasTabs: Boolean,
    actions: DeckBarActions,
) {
    var menu by remember { mutableStateOf(false) }
    val label = stringResource(if (isIncognito) R.string.tabs_new_incognito_tab else R.string.tabs_new_tab)
    val hint = stringResource(R.string.tabs_plus_hint)
    val dark = LocalArdiaDarkTheme.current
    Box(Modifier.heightIn(min = BrowseLayout.hitTarget), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(TabsLayout.barPlus)
                .frosted(backdrop, CircleShape, style)
                .combinedClickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = ripple(bounded = true),
                    onLongClick = { menu = true },
                    onClick = actions.newTab,
                )
                .clearAndSetSemantics {
                    contentDescription = label
                    role = Role.Button
                    onClick { actions.newTab(); true }
                    onLongClick(hint) { menu = true; true }
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(ArdiaSymbols.plus, null, Modifier.size(22.dp), tint = SystemPalette.label.resolve(dark))
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            val pick = { action: () -> Unit -> { menu = false; action() } }
            if (isIncognito) {
                MenuRow(stringResource(R.string.tabs_new_tab), ArdiaSymbols.plus, action = pick(actions.newRegularTab))
                MenuRow(stringResource(R.string.tabs_new_incognito_tab), ArdiaSymbols.eyes, action = pick(actions.newTab))
            } else {
                MenuRow(stringResource(R.string.tabs_new_incognito_tab), ArdiaSymbols.eyes, action = pick(actions.newIncognitoTab))
                if (canReopen) MenuRow(stringResource(R.string.tabs_reopen_closed_tab), ArdiaSymbols.arrowUturnBackward, action = pick(actions.reopen))
            }
            if (hasTabs) {
                HorizontalDivider()
                MenuRow(
                    stringResource(if (isIncognito) R.string.tabs_close_incognito_tabs else R.string.tabs_close_all_tabs),
                    ArdiaSymbols.xmark,
                    destructive = true,
                    action = pick(actions.closeAll),
                )
            }
        }
    }
}

@Composable
internal fun DeckCircleButton(symbol: ImageVector, label: String, backdrop: FrostedBackdrop?, style: FrostedStyle, action: () -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    Box(
        Modifier
            .size(BrowseLayout.hitTarget)
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = ripple(bounded = false, radius = TabsLayout.barCircle / 2),
                onClick = action,
            )
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                onClick { action(); true }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(TabsLayout.barCircle).frosted(backdrop, CircleShape, style), contentAlignment = Alignment.Center) {
            Icon(symbol, null, Modifier.size(17.dp), tint = SystemPalette.secondaryLabel.resolve(dark))
        }
    }
}

@Composable
internal fun IncognitoChip(count: Int, close: () -> Unit, modifier: Modifier = Modifier) {
    var menu by remember { mutableStateOf(false) }
    val label = stringResource(R.string.tabs_incognito_chip, count)
    val hint = stringResource(R.string.tabs_incognito_chip_hint)
    Box(modifier.heightIn(min = 44.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .heightIn(min = 32.dp)
                .background(TabsPalette.incognitoCard, CircleShape)
                .combinedClickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = ripple(),
                    onClick = { menu = true },
                )
                .clearAndSetSemantics {
                    contentDescription = label
                    role = Role.Button
                    onClick(hint) { menu = true; true }
                }
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            IncognitoGlyph(16.dp)
            Text(stringResource(R.string.tabs_incognito), style = ArdiaType.subheadline.semibold, color = androidx.compose.ui.graphics.Color.White)
            Text(count.toString(), style = ArdiaType.subheadline.semibold.monospacedDigits, color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.6f))
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            MenuRow(stringResource(R.string.tabs_close_incognito_tabs), ArdiaSymbols.xmark, destructive = true) {
                menu = false
                close()
            }
        }
    }
}

@Composable
internal fun DeckEmptyState(showsArchive: Boolean, openArchive: () -> Unit, modifier: Modifier = Modifier) {
    val dark = LocalArdiaDarkTheme.current
    Column(
        modifier.widthIn(max = 300.dp).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(stringResource(R.string.tabs_no_open_tabs), style = ArdiaType.title3.semibold, color = TabsPalette.headerText.resolve(dark), textAlign = TextAlign.Center)
        Text(
            stringResource(R.string.tabs_no_open_tabs_message),
            style = ArdiaType.subheadline,
            color = SystemPalette.secondaryLabel.resolve(dark),
            textAlign = TextAlign.Center,
        )
        if (showsArchive) {
            TextButton(onClick = openArchive, modifier = Modifier.padding(top = 6.dp).sizeIn(minHeight = 44.dp)) {
                Text(stringResource(R.string.tabs_open_archive), style = ArdiaType.subheadline.semibold, color = Palette.formAccent.resolve(dark))
            }
        }
    }
}
