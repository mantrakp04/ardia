package com.ardia.tabs

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.BrowsePalette
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.SystemPalette
import com.ardia.design.TabsLayout
import com.ardia.design.TabsPalette
import com.ardia.design.ardiaGradient
import com.ardia.store.AutoArchiveInterval
import kotlinx.coroutines.delay

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ArchiveIntervalCard(interval: AutoArchiveInterval, choose: (AutoArchiveInterval) -> Unit, dismiss: () -> Unit, modifier: Modifier = Modifier) {
    val dark = LocalArdiaDarkTheme.current
    val shape = RoundedCornerShape(TabsLayout.archiveCardRadius)
    val dismissLabel = stringResource(R.string.tabs_dismiss)
    val latestDismiss by rememberUpdatedState(dismiss)
    var changed by remember { mutableStateOf(0) }
    LaunchedEffect(changed) {
        if (changed == 0) return@LaunchedEffect
        delay(DISMISS_DELAY_MILLIS)
        latestDismiss()
    }
    FlowRow(
        modifier
            .widthIn(max = 520.dp)
            .fillMaxWidth()
            .shadow(24.dp, shape, ambientColor = TabsPalette.cardShadow, spotColor = TabsPalette.cardShadow)
            .background(BrowsePalette.popover.resolve(dark), shape)
            .semantics { customActions = listOf(CustomAccessibilityAction(dismissLabel) { latestDismiss(); true }) }
            .padding(start = 14.dp, end = 4.dp, top = 14.dp, bottom = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ArchiveTile(TabsLayout.archiveCardTile * minOf(LocalDensity.current.fontScale, 48f / 28f))
            Text(stringResource(R.string.tabs_archive_inactive_tabs), style = ArdiaType.body, color = SystemPalette.label.resolve(dark))
        }
        IntervalPicker(interval) {
            choose(it)
            changed += 1
        }
    }
}

@Composable
internal fun ArchiveTile(side: androidx.compose.ui.unit.Dp) {
    Box(
        Modifier.size(side).background(TabsPalette.archiveTile.ardiaGradient(), RoundedCornerShape(side * 0.25f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(ArdiaSymbols.archiveboxFill, null, Modifier.size(side * 0.55f), tint = Color.White)
    }
}

@Composable
internal fun IntervalPicker(interval: AutoArchiveInterval, choose: (AutoArchiveInterval) -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    var open by remember { mutableStateOf(false) }
    val label = stringResource(R.string.tabs_archive_inactive_tabs)
    Box {
        Row(
            Modifier
                .heightIn(min = 44.dp)
                .clickable(onClickLabel = label) { open = true }
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(interval.title, style = ArdiaType.body, color = SystemPalette.secondaryLabel.resolve(dark))
            Icon(ArdiaSymbols.chevronUpChevronDown, null, Modifier.size(14.dp), tint = SystemPalette.secondaryLabel.resolve(dark))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (option in AutoArchiveInterval.entries) {
                MenuRow(option.title, if (option == interval) ArdiaSymbols.checkmark else null) {
                    open = false
                    if (option != interval) choose(option)
                }
            }
        }
    }
}

private const val DISMISS_DELAY_MILLIS = 600L
