package com.ardia.search

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.BrowseLayout
import com.ardia.design.BrowsePalette
import com.ardia.design.FaviconImage
import com.ardia.design.Motion
import com.ardia.design.Spacing
import com.ardia.design.adaptive
import com.ardia.store.SearchSuggestion
import kotlinx.coroutines.flow.collectLatest

@Immutable
internal class RowMenuItem(val label: String, val icon: ImageVector, val action: () -> Unit)

@Stable
internal interface RowActions {
    fun activate(row: TrayRow)

    fun refine(suggestion: SearchSuggestion)

    fun menu(suggestion: SearchSuggestion): List<RowMenuItem>
}

private sealed interface PressOutcome {
    data class Released(val position: Offset) : PressOutcome

    data object Scrubbing : PressOutcome

    data object Cancelled : PressOutcome
}

private class ListAnchor {
    var coordinates: LayoutCoordinates? = null
}

private val rowHighlightColor = adaptive(Color.Black.copy(alpha = 0.05f), Color.White.copy(alpha = 0.08f))
private val incognitoHighlight = Color.White.copy(alpha = 0.1f)

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun SuggestionList(
    rows: List<TrayRow>,
    typed: String,
    isIncognito: Boolean,
    scrollable: Boolean,
    scrub: ScrubState,
    actions: RowActions,
    visibleHeight: () -> Float,
    modifier: Modifier = Modifier,
) {
    val currentRows by rememberUpdatedState(rows)
    val currentBudget by rememberUpdatedState(visibleHeight)
    val density = LocalDensity.current
    val view = LocalView.current
    val fontScale = density.fontScale
    val pitch = BrowseLayout.suggestionPitch * fontScale
    val iconSlot = 22.dp * fontScale
    val anchor = remember { ListAnchor() }
    var menuFor by remember { mutableStateOf<String?>(null) }
    val highlightAlpha = remember { Animatable(0f) }
    var drawnIndex by remember { mutableIntStateOf(ScrubTargets.NONE) }
    val highlight = if (isIncognito) incognitoHighlight else rowHighlightColor.current
    val radius = with(density) { 14.dp.toPx() }

    SideEffect { scrub.targets.resize(rows.size) }

    LaunchedEffect(scrub) {
        snapshotFlow { scrub.highlighted }.collectLatest { index ->
            if (index >= 0) {
                val appearing = drawnIndex < 0 || highlightAlpha.value < 0.01f
                drawnIndex = index
                if (appearing) highlightAlpha.animateTo(1f, Motion.press.spec()) else highlightAlpha.snapTo(1f)
            } else {
                highlightAlpha.animateTo(0f, Motion.press.spec())
                drawnIndex = ScrubTargets.NONE
            }
        }
    }

    val gestures = if (scrollable) {
        Modifier.verticalScroll(rememberScrollState())
    } else {
        Modifier.pointerInput(scrub, actions) {
            val slack = 8.dp.toPx()
            val scrubDistance = 6.dp.toPx()
            val refineWidth = REFINE_WIDTH.toPx()
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = true)
                val budget = minOf(size.height.toFloat(), currentBudget())
                val pointer = down.id
                scrub.begin(down.position.x, down.position.y, budget, slack)
                down.consume()

                fun follow(change: PointerInputChange) {
                    if (scrub.move(change.position.x, change.position.y, budget, slack, scrubDistance)) tick(view)
                    change.consume()
                }

                val early = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                    var outcome: PressOutcome? = null
                    while (outcome == null) {
                        val change = nextChange(pointer)
                        outcome = when {
                            change == null -> PressOutcome.Cancelled
                            !change.pressed -> PressOutcome.Released(change.position).also { change.consume() }
                            else -> {
                                follow(change)
                                if (scrub.isScrubbing) PressOutcome.Scrubbing else null
                            }
                        }
                    }
                    outcome
                }

                val held = scrub.highlighted
                if (early == null && held >= 0 && !scrub.isScrubbing) {
                    val row = currentRows.getOrNull(held)
                    scrub.cancel()
                    if (row is TrayRow.Suggested) {
                        view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                        menuFor = row.key
                    }
                    do {
                        val change = nextChange(pointer) ?: break
                        change.consume()
                    } while (change.pressed)
                    return@awaitEachGesture
                }

                var outcome = early
                while (outcome == null || outcome == PressOutcome.Scrubbing) {
                    val change = nextChange(pointer)
                    outcome = when {
                        change == null -> PressOutcome.Cancelled
                        !change.pressed -> PressOutcome.Released(change.position).also { change.consume() }
                        else -> {
                            follow(change)
                            PressOutcome.Scrubbing
                        }
                    }
                }

                when (val finished = outcome) {
                    is PressOutcome.Released -> {
                        val release = scrub.end(finished.position.x, finished.position.y, budget, slack)
                        if (release is ScrubState.Release.Activate) {
                            val row = currentRows.getOrNull(release.index) ?: return@awaitEachGesture
                            if (release.wasScrubbing) confirm(view)
                            val onRefine = !release.wasScrubbing && TrayRows.isRefinable(row) &&
                                finished.position.x >= scrub.targets.right(release.index) - refineWidth
                            if (onRefine) actions.refine((row as TrayRow.Suggested).suggestion) else actions.activate(row)
                        }
                    }
                    else -> scrub.cancel()
                }
            }
        }
    }

    Column(
        modifier
            .fillMaxWidth()
            .onPlaced { anchor.coordinates = it }
            .then(gestures)
            .drawBehind {
                val index = drawnIndex
                val alpha = highlightAlpha.value
                if (index < 0 || alpha <= 0f || index >= scrub.targets.count) return@drawBehind
                val top = scrub.targets.top(index)
                val left = scrub.targets.left(index)
                drawRoundRect(
                    color = highlight,
                    topLeft = Offset(left, top),
                    size = Size(scrub.targets.right(index) - left, scrub.targets.bottom(index) - top),
                    cornerRadius = CornerRadius(radius, radius),
                    alpha = alpha,
                )
            }
            .padding(horizontal = Spacing.tight)
            .padding(bottom = Spacing.tight),
    ) {
        rows.forEachIndexed { index, row ->
            key(row.key) {
                val rowModifier = Modifier.onPlaced { coordinates ->
                    val list = anchor.coordinates ?: return@onPlaced
                    if (!list.isAttached || !coordinates.isAttached) return@onPlaced
                    val origin = list.localPositionOf(coordinates, Offset.Zero)
                    scrub.targets.place(index, origin.x, origin.y, origin.x + coordinates.size.width, origin.y + coordinates.size.height)
                }
                val interactive = if (scrollable) {
                    Modifier.combinedClickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onLongClick = { if (row is TrayRow.Suggested) menuFor = row.key },
                        onClick = { actions.activate(row) },
                    )
                } else {
                    Modifier
                }
                SuggestionRow(
                    row = row,
                    typed = typed,
                    isIncognito = isIncognito,
                    pitch = pitch,
                    iconSlot = iconSlot,
                    isMenuOpen = menuFor == row.key,
                    actions = actions,
                    onDismissMenu = { menuFor = null },
                    modifier = rowModifier.then(interactive),
                )
            }
        }
    }
}

@Composable
private fun SuggestionRow(
    row: TrayRow,
    typed: String,
    isIncognito: Boolean,
    pitch: Dp,
    iconSlot: Dp,
    isMenuOpen: Boolean,
    actions: RowActions,
    onDismissMenu: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val primary = if (isIncognito) Color.White.copy(alpha = 0.92f) else BrowsePalette.foregroundPrimary.current
    val secondary = if (isIncognito) BrowsePalette.incognitoCaption else BrowsePalette.foregroundSecondary.current
    val iconTint = if (isIncognito) BrowsePalette.incognitoCaption else BrowsePalette.rowIcon.current
    val refineLabel = (row as? TrayRow.Suggested)?.let { stringResource(R.string.search_refine, it.suggestion.title) }
    val suggestion = (row as? TrayRow.Suggested)?.suggestion
    val refinable = TrayRows.isRefinable(row)
    Box(
        modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {
                role = Role.Button
                onClick {
                    actions.activate(row)
                    true
                }
                if (suggestion != null) {
                    val extra = ArrayList<CustomAccessibilityAction>()
                    if (refinable && refineLabel != null) extra.add(CustomAccessibilityAction(refineLabel) { actions.refine(suggestion); true })
                    actions.menu(suggestion).mapTo(extra) { item -> CustomAccessibilityAction(item.label) { item.action(); true } }
                    if (extra.isNotEmpty()) customActions = extra
                }
            },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = pitch)
                .padding(start = 12.dp, end = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(iconSlot), contentAlignment = Alignment.Center) {
                RowLeading(row, iconSlot, iconTint)
            }
            Box(Modifier.weight(1f)) {
                RowLabel(row, typed, primary, secondary)
            }
            if (refinable) {
                Box(Modifier.size(REFINE_WIDTH, pitch), contentAlignment = Alignment.Center) {
                    Icon(ArdiaSymbols.arrowUpForward, contentDescription = null, modifier = Modifier.size(15.dp).rotate(-90f), tint = iconTint)
                }
            }
        }
        if (isMenuOpen && suggestion != null) {
            DropdownMenu(expanded = true, onDismissRequest = onDismissMenu) {
                for (item in remember(suggestion, actions) { actions.menu(suggestion) }) {
                    DropdownMenuItem(
                        text = { Text(item.label) },
                        leadingIcon = { Icon(item.icon, contentDescription = null, modifier = Modifier.size(18.dp)) },
                        onClick = {
                            onDismissMenu()
                            item.action()
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun RowLeading(row: TrayRow, iconSlot: Dp, tint: Color) {
    when (row) {
        is TrayRow.Paste -> Icon(
            if (row.offer == ClipboardOffer.Link) ArdiaSymbols.link else ArdiaSymbols.docOnDoc,
            contentDescription = null,
            modifier = Modifier.size(SYMBOL_SIZE),
            tint = tint,
        )
        is TrayRow.Suggested -> {
            val suggestion = row.suggestion
            val url = suggestion.url
            if (suggestion.showsFavicon && url != null) {
                FaviconImage(iconUrl = suggestion.favicon, pageUrl = url, size = iconSlot * 0.82f)
            } else {
                Icon(SuggestionSymbols.of(suggestion.kind), contentDescription = null, modifier = Modifier.size(SYMBOL_SIZE), tint = tint)
            }
        }
    }
}

@Composable
private fun RowLabel(row: TrayRow, typed: String, primary: Color, secondary: Color) {
    val largeText = LocalDensity.current.fontScale > LARGE_FONT_SCALE
    when (row) {
        is TrayRow.Paste -> TitleAndDetail(
            title = stringResource(R.string.search_paste_and_go),
            primary = primary,
            secondary = secondary,
            largeText = largeText,
        ) {
            Text(
                stringResource(if (row.offer == ClipboardOffer.Link) R.string.search_link_you_copied else R.string.search_text_you_copied),
                style = ArdiaType.subheadline,
                color = secondary,
                maxLines = 1,
            )
        }
        is TrayRow.Suggested -> {
            val suggestion = row.suggestion
            when (val kind = suggestion.kind) {
                SearchSuggestion.Kind.Query -> {
                    val text = remember(suggestion.title, typed, primary, secondary) { queryText(suggestion.title, typed, primary, secondary) }
                    Text(text, style = ArdiaType.title3, maxLines = if (largeText) 4 else 2, overflow = TextOverflow.Ellipsis)
                }
                else -> TitleAndDetail(suggestion.title, primary, secondary, largeText) {
                    when {
                        kind is SearchSuggestion.Kind.RemoteTab && kind.deviceName.isNotEmpty() ->
                            DetailWithIcon(ArdiaSymbols.laptopcomputer, suggestion.detail ?: kind.deviceName, secondary)
                        kind is SearchSuggestion.Kind.OpenTab ->
                            DetailWithIcon(ArdiaSymbols.arrowRightCircle, stringResource(R.string.search_switch_to_tab), secondary)
                        else -> suggestion.detail?.let { Text(it, style = ArdiaType.subheadline, color = secondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
}

@Composable
private fun TitleAndDetail(title: String, primary: Color, secondary: Color, largeText: Boolean, detail: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(title, style = ArdiaType.body, color = primary, maxLines = if (largeText) 3 else 1, overflow = TextOverflow.Ellipsis)
        detail()
    }
}

@Composable
private fun DetailWithIcon(icon: ImageVector, text: String, color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(13.dp), tint = color)
        Text(text, style = ArdiaType.subheadline, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun queryText(title: String, typed: String, primary: Color, secondary: Color): AnnotatedString {
    val prefix = TrayRows.queryPrefixLength(title, typed)
    return buildAnnotatedString {
        if (prefix > 0) withStyle(SpanStyle(color = secondary)) { append(title, 0, prefix) }
        withStyle(SpanStyle(color = primary)) { append(title, prefix, title.length) }
    }
}

internal object SuggestionSymbols {
    fun of(kind: SearchSuggestion.Kind): ImageVector = when (kind) {
        SearchSuggestion.Kind.Query -> ArdiaSymbols.magnifyingglass
        SearchSuggestion.Kind.Url -> ArdiaSymbols.globe
        is SearchSuggestion.Kind.OpenTab -> ArdiaSymbols.squareOnSquare
        is SearchSuggestion.Kind.RemoteTab -> ArdiaSymbols.laptopcomputer
        SearchSuggestion.Kind.History -> ArdiaSymbols.clockArrowCirclepath
        SearchSuggestion.Kind.Bookmark -> ArdiaSymbols.star
        SearchSuggestion.Kind.Calculation -> ArdiaSymbols.equalCircleFill
    }
}

private suspend fun AwaitPointerEventScope.nextChange(pointer: PointerId): PointerInputChange? =
    awaitPointerEvent().changes.firstOrNull { it.id == pointer }

private fun tick(view: View) {
    val constant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
    view.performHapticFeedback(constant)
}

private fun confirm(view: View) {
    val constant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
    view.performHapticFeedback(constant)
}

internal const val LARGE_FONT_SCALE = 1.5f
private val REFINE_WIDTH = 40.dp
private val SYMBOL_SIZE = 19.dp
