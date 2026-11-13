package com.ardia.browsing

import android.graphics.Bitmap
import android.view.HapticFeedbackConstants
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.browser.PageColors
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaThemeState
import com.ardia.design.BarPalette
import com.ardia.design.BrowseLayout
import com.ardia.design.BrowsePalette
import com.ardia.design.FaviconImage
import com.ardia.design.Motion
import com.ardia.design.SystemPalette
import com.ardia.design.TabsPalette
import com.ardia.design.parseHexColor
import com.ardia.store.BrowserTab
import com.ardia.store.BrowserUrl

internal object BrowsingTags {
    const val BAR = "browsing.bar"
    const val TABS = "browsing.bar.tabs"
    const val PLUS = "browsing.bar.plus"
    const val MORE = "browsing.bar.more"
    const val PAGE = "browsing.page"
    const val MENU = "browsing.menu"
    const val FIND_BAR = "browsing.find"
    const val FIND_FIELD = "browsing.find.field"
    const val FIND_COUNT = "browsing.find.count"
    const val READER = "browsing.reader"
    const val SITE_SETTINGS = "browsing.siteSettings"
    const val FAILURE = "browsing.failure"
    const val REQUEST = "browsing.request"
    const val PRESS_MENU = "browsing.press"
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun BottomBar(
    model: AppModel,
    isSearchPresented: Boolean,
    onTabs: () -> Unit,
    onPlus: () -> Unit,
    onMore: () -> Unit,
    onStep: (Int) -> Unit,
    onSelectTab: (String) -> Unit,
    onCloseTab: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val order = model.deckOrder
    var showsRecent by remember { mutableStateOf(false) }
    val tabsLabel = stringResource(R.string.browsing_tabs)
    val tabCount = pluralStringResource(R.plurals.browsing_tab_count, order.size, order.size)
    val previous = stringResource(R.string.browsing_previous_tab)
    val next = stringResource(R.string.browsing_next_tab)
    val hint = stringResource(R.string.browsing_tabs_hint)
    Row(
        modifier.fillMaxWidth().padding(horizontal = BrowseLayout.barSideInset - 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            val interaction = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .testTag(BrowsingTags.TABS)
                    .barPress(interaction)
                    .size(47.dp, BrowseLayout.hitTarget)
                    .combinedClickable(
                        interactionSource = interaction,
                        indication = null,
                        onClickLabel = tabsLabel,
                        onLongClickLabel = hint,
                        onLongClick = { showsRecent = true },
                        onClick = onTabs,
                    )
                    .semantics {
                        contentDescription = tabsLabel
                        stateDescription = tabCount
                        role = Role.Button
                        customActions = listOf(
                            CustomAccessibilityAction(previous) { onStep(-1); true },
                            CustomAccessibilityAction(next) { onStep(1); true },
                        )
                    },
                contentAlignment = Alignment.Center,
            ) {
                TabStackGlyph(model, order.takeLast(2), Modifier.offset(x = (-2.8).dp))
            }
            RecentTabsMenu(model, order, showsRecent, onDismiss = { showsRecent = false }, onSelectTab = onSelectTab, onCloseTab = onCloseTab)
        }
        Box(Modifier.size(BrowseLayout.plusCapsule), contentAlignment = Alignment.Center) {
            if (!isSearchPresented) {
                val interaction = remember { MutableInteractionSource() }
                val label = stringResource(R.string.browsing_new_search)
                Box(
                    Modifier
                        .testTag(BrowsingTags.PLUS)
                        .barPress(interaction)
                        .size(BrowseLayout.plusCapsule)
                        .clip(CircleShape)
                        .background(BarPalette.plusFill.current)
                        .border(0.33.dp, BarPalette.controlEdge.current, CircleShape)
                        .combinedClickable(interactionSource = interaction, indication = null, onClick = onPlus)
                        .semantics {
                            contentDescription = label
                            role = Role.Button
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(ArdiaSymbols.plus, null, Modifier.size(17.dp), tint = BrowsePalette.foregroundPrimary.current)
                }
            }
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            val interaction = remember { MutableInteractionSource() }
            val label = stringResource(R.string.browsing_page_menu)
            Box(
                Modifier
                    .testTag(BrowsingTags.MORE)
                    .barPress(interaction)
                    .size(BrowseLayout.hitTarget)
                    .combinedClickable(interactionSource = interaction, indication = null, onClick = onMore)
                    .semantics {
                        contentDescription = label
                        role = Role.Button
                    },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(BrowseLayout.chevronCircle)
                        .background(BarPalette.chevronFill.current, CircleShape)
                        .border(0.33.dp, BarPalette.controlEdge.current, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(ArdiaSymbols.chevronUp, null, Modifier.size(16.dp), tint = BrowsePalette.foregroundPrimary.current)
                }
            }
        }
    }
}

@Composable
private fun RecentTabsMenu(
    model: AppModel,
    order: List<BrowserTab>,
    expanded: Boolean,
    onDismiss: () -> Unit,
    onSelectTab: (String) -> Unit,
    onCloseTab: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        val recent = remember(order) { order.dropLast(1).takeLast(8).reversed() }
        for (tab in recent) {
            DropdownMenuItem(
                text = { Text(PageMenuText.tabTitle(tab, BrowserUrl.host(tab.url)), maxLines = 1) },
                onClick = {
                    onDismiss()
                    onSelectTab(tab.id)
                },
            )
        }
        if (recent.isNotEmpty()) HorizontalDivider()
        DropdownMenuItem(
            text = { Text(stringResource(R.string.browsing_close_tab), color = SystemPalette.red.current) },
            leadingIcon = { Icon(ArdiaSymbols.xmark, null, Modifier.size(18.dp), tint = SystemPalette.red.current) },
            onClick = {
                onDismiss()
                onCloseTab()
            },
            enabled = model.tabs.selectedTabId != null,
        )
    }
}

@Composable
internal fun Modifier.barPress(interaction: MutableInteractionSource): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val view = LocalView.current
    LaunchedEffect(pressed) {
        if (pressed) view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    }
    val scale by animateFloatAsState(
        targetValue = if (pressed) BrowseLayout.barControlScale else 1f,
        animationSpec = (if (pressed) Motion.barPressIn else Motion.barPressOut).spec(),
        label = "barPress",
    )
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

@Composable
private fun TabStackGlyph(model: AppModel, tabs: List<BrowserTab>, modifier: Modifier = Modifier) {
    val tile = BrowseLayout.tabStackTile
    Box(modifier.clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        when (tabs.size) {
            0 -> Box(
                Modifier
                    .size(tile)
                    .border(1.5.dp, BrowsePalette.foregroundSecondary.current, RoundedCornerShape(BrowseLayout.tabStackRadius)),
            )
            1 -> TabThumbnail(model, tabs[0], Modifier.rotate(-4f))
            else -> {
                TabThumbnail(model, tabs[0], Modifier.offset(x = (-4).dp, y = 1.dp).rotate(-12f))
                TabThumbnail(model, tabs[1], Modifier.offset(x = 4.dp, y = (-1).dp).rotate(6f))
            }
        }
    }
}

@Composable
private fun TabThumbnail(model: AppModel, tab: BrowserTab, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(BrowseLayout.tabStackRadius)
    val version = model.snapshotVersion(tab.id)
    var stored by remember(tab.id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(tab.id, tab.snapshotFileName, version) {
        stored = if (tab.snapshotFileName == null) null else model.snapshotImage(tab)
    }
    val memory = model.browse.covers.image(tab.id) ?: model.deck.memoryImage(tab.id)
    val image = memory ?: stored
    Box(
        modifier
            .shadow(1.5.dp, shape, ambientColor = Color.Black.copy(alpha = 0.2f), spotColor = Color.Black.copy(alpha = 0.2f))
            .size(BrowseLayout.tabStackTile)
            .clip(shape)
            .border(0.5.dp, BarPalette.tileEdge.current, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null) {
            val bitmap = remember(image) { image.asImageBitmap() }
            Image(bitmap, null, Modifier.size(BrowseLayout.tabStackTile), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
        } else if (tab.isPrivate) {
            Box(Modifier.size(BrowseLayout.tabStackTile).background(TabsPalette.incognitoCard), contentAlignment = Alignment.Center) {
                Icon(ArdiaSymbols.eyes, null, Modifier.size(12.dp), tint = Color.White.copy(alpha = 0.8f))
            }
        } else {
            val theme = parseHexColor(tab.themeColorHex)
            Box(Modifier.size(BrowseLayout.tabStackTile).background(theme ?: BarPalette.tileFill.current), contentAlignment = Alignment.Center) {
                FaviconImage(iconUrl = tab.faviconUrl, pageUrl = tab.url, size = 12.dp)
            }
        }
    }
}

@Composable
internal fun Modifier.barBacking(tone: Int?): Modifier {
    val look = ArdiaThemeState.look
    val surface = look.surface.current
    val target = tone?.let { Color(it) } ?: surface
    val color by animateColorAsState(target, Motion.barTone.spec(), label = "barTone")
    val toneIsDark = tone?.let(PageColors::isDark)
    return drawBehind {
        drawRect(color)
        when (toneIsDark) {
            true -> drawRect(Color.White.copy(alpha = 0.06f))
            false -> drawRect(Color.Black.copy(alpha = 0.025f))
            null -> Unit
        }
    }
}
