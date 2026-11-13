package com.ardia.browsing

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.ardia.browser.FindResult
import com.ardia.browser.Page
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaThemeState
import com.ardia.design.ArdiaType
import com.ardia.design.BrowseLayout
import com.ardia.design.BrowsePalette
import com.ardia.design.Palette
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.monospacedDigits
import com.ardia.design.semibold

sealed interface FindCount {
    data class Match(val position: Int, val total: Int) : FindCount

    data object None : FindCount

    companion object {
        fun of(result: FindResult?, query: String): FindCount? {
            if (query.isEmpty() || result == null || result.query != query) return null
            if (result.total == 0) return if (result.isDone) None else null
            return Match(result.activeIndex.coerceAtLeast(0) + 1, result.total)
        }
    }
}

@Composable
internal fun FindBar(page: Page, onDone: () -> Unit, modifier: Modifier = Modifier) {
    var query by rememberSaveable(page.id) { mutableStateOf("") }
    val result by page.find.collectAsState()
    val focus = remember { FocusRequester() }
    LaunchedEffect(page) { focus.requestFocus() }
    LaunchedEffect(page, query) { if (query.isEmpty()) page.endFind() else page.find(query) }
    val count = when (val found = FindCount.of(result, query)) {
        is FindCount.Match -> stringResource(R.string.browsing_find_count, found.position, found.total)
        FindCount.None -> stringResource(R.string.browsing_find_none)
        null -> null
    }
    val hasMatches = (result?.total ?: 0) > 0 && result?.query == query
    val surface = ArdiaThemeState.look.surface.current
    Box(
        modifier
            .testTag(BrowsingTags.FIND_BAR)
            .fillMaxWidth()
            .background(surface)
            .navigationBarsPadding()
            .imePadding(),
    ) {
        HorizontalDivider(thickness = 0.5.dp, color = SystemPalette.separator.current)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.small, vertical = Spacing.tight),
            horizontalArrangement = Arrangement.spacedBy(Spacing.hairline),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier
                    .weight(1f)
                    .heightIn(min = 40.dp)
                    .background(BrowsePalette.fieldFill.current, CircleShape)
                    .border(0.5.dp, BrowsePalette.fieldStroke.current, CircleShape)
                    .padding(horizontal = Spacing.small),
                horizontalArrangement = Arrangement.spacedBy(Spacing.tight),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(ArdiaSymbols.magnifyingglass, null, Modifier.size(16.dp), tint = BrowsePalette.foregroundSecondary.current)
                val placeholder = stringResource(R.string.browsing_find_placeholder)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) Text(placeholder, style = ArdiaType.body, color = BrowsePalette.foregroundTertiary.current, maxLines = 1)
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = ArdiaType.body.copy(color = SystemPalette.label.current),
                        cursorBrush = SolidColor(Palette.formAccent.current),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { if (hasMatches) page.findNext() }),
                        modifier = Modifier
                            .testTag(BrowsingTags.FIND_FIELD)
                            .fillMaxWidth()
                            .focusRequester(focus)
                            .semantics { contentDescription = placeholder },
                    )
                }
                if (count != null) {
                    Text(
                        count,
                        style = ArdiaType.subheadline.monospacedDigits,
                        color = if (hasMatches) BrowsePalette.foregroundSecondary.current else BrowsePalette.findError,
                        maxLines = 1,
                        modifier = Modifier.testTag(BrowsingTags.FIND_COUNT).semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
            FindButton(ArdiaSymbols.chevronUp, stringResource(R.string.browsing_previous_match), hasMatches) { page.findPrevious() }
            FindButton(ArdiaSymbols.chevronDown, stringResource(R.string.browsing_next_match), hasMatches) { page.findNext() }
            Box(
                Modifier
                    .heightIn(min = BrowseLayout.hitTarget)
                    .clickable(role = Role.Button, onClick = onDone)
                    .padding(horizontal = Spacing.tight),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.browsing_done), style = ArdiaType.body.semibold, color = Palette.formAccent.current)
            }
        }
    }
}

@Composable
private fun FindButton(icon: ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(BrowseLayout.hitTarget - 4.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(18.dp), tint = if (enabled) SystemPalette.label.current else SystemPalette.tertiaryLabel.current)
    }
}
