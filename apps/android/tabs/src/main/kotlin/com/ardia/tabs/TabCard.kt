package com.ardia.tabs

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ardia.appmodel.AppModel
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.DeckHeaderMetrics
import com.ardia.design.FaviconImage
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.Palette
import com.ardia.design.SystemPalette
import com.ardia.design.TabsLayout
import com.ardia.design.TabsMotion
import com.ardia.design.TabsPalette
import com.ardia.design.Toasts
import com.ardia.design.ardiaColor
import com.ardia.design.parseHexColor
import com.ardia.design.semibold
import com.ardia.store.BrowserTab
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
internal fun DeckCardItem(model: AppModel, state: DeckState, haptics: Haptics, tab: BrowserTab, index: Int, isLast: Boolean) {
    val id = tab.id
    val pose = remember(id) { DeckPose() }
    val frame = remember(id) { DeckPose() }
    val shapes = remember(id) { CardShapeCache() }
    remember(id) { state.motion(id) }
    val dark = LocalArdiaDarkTheme.current
    val newTab = stringResource(R.string.tabs_new_tab)
    val title = TabText.title(tab, newTab)
    val host = TabText.host(tab, newTab)
    val value = if (tab.isPrivate) stringResource(R.string.tabs_incognito_value, host) else host
    val hint = stringResource(R.string.tabs_card_hint)
    val closeLabel = stringResource(R.string.tabs_close_tab)
    val image = rememberSnapshot(model, tab)
    Box(
        Modifier
            .deckCardPlacement(state, id, index, isLast, pose, shapes, TabsPalette.cardShadow)
            .deckCardEdge(state, id, index, frame, TabsPalette.cardEdge.resolve(dark))
            .clearAndSetSemantics {
                contentDescription = title
                stateDescription = value
                role = Role.Button
                testTag = DECK_CARD_TAG
                this[ShownSnapshot] = image
                onClick(hint) {
                    state.open(id)
                    true
                }
                customActions = listOf(
                    CustomAccessibilityAction(closeLabel) {
                        state.close(id, animated = false)
                        true
                    },
                )
            },
    ) {
        TabCardContent(tab, image, title, host)
        if (TabText.isUnseenReceived(tab)) ReceivedBadge(Modifier.padding(10.dp))
        DropdownMenu(expanded = state.menuFor == id, onDismissRequest = { if (state.menuFor == id) state.menuFor = null }) {
            CardMenu(model, tab, dismiss = { state.menuFor = null }, close = { state.close(id, animated = true) }, copied = haptics::success)
        }
    }
}

@Composable
internal fun DeckCardHeaderItem(state: DeckState, tab: BrowserTab, index: Int, isLast: Boolean) {
    val pose = remember(tab.id) { DeckPose() }
    val title = TabText.title(tab, stringResource(R.string.tabs_new_tab))
    val dark = LocalArdiaDarkTheme.current
    val fade = with(LocalDensity.current) { DeckHeaderMetrics.trailingFade.dp.toPx() }
    val fontScale = LocalDensity.current.fontScale
    val style = ArdiaType.caption.copy(
        fontWeight = FontWeight.Medium,
        fontSize = (12 * min(fontScale, HEADER_MAX_FONT_SCALE) / fontScale).sp,
        lineHeight = (16 * min(fontScale, HEADER_MAX_FONT_SCALE) / fontScale).sp,
    )
    Box(
        Modifier
            .deckHeaderPlacement(state, tab.id, index, isLast, pose)
            .clearAndSetSemantics {}
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                val start = max(size.width - fade, 0f)
                drawRect(
                    Brush.horizontalGradient(listOf(Color.Black, Color.Transparent), startX = start, endX = size.width),
                    topLeft = Offset(start, 0f),
                    size = Size(size.width - start, size.height),
                    blendMode = BlendMode.DstIn,
                )
            },
    ) {
        DeckHeaderRow(
            icon = {
                if (tab.isPrivate) {
                    Box(Modifier.background(TabsPalette.incognitoCardRaised, RoundedCornerShape(TabsLayout.faviconRadius)).padding(2.dp)) {
                        IncognitoGlyph(TabsLayout.faviconSize)
                    }
                } else {
                    FaviconImage(tab.faviconUrl, tab.url, size = TabsLayout.faviconSize)
                }
            },
            title = { Text(title, style = style, color = TabsPalette.headerText.resolve(dark), maxLines = 1, softWrap = false) },
        )
    }
}

@Composable
private fun DeckHeaderRow(icon: @Composable () -> Unit, title: @Composable () -> Unit) {
    Layout(contents = listOf(icon, title)) { (iconMeasurables, titleMeasurables), constraints ->
        val iconPlaceable = iconMeasurables.first().measure(Constraints())
        val titlePlaceable = titleMeasurables.first().measure(Constraints())
        val width = constraints.maxWidth
        val height = max(max(iconPlaceable.height, titlePlaceable.height), (HEADER_HEIGHT * density).roundToInt())
        val reveal = DeckHeaderMetrics.titleReveal(width / density.toDouble())
        val spacing = TabsLayout.headerSpacing.toPx()
        val leading = DeckHeaderMetrics.contentLeading(
            available = width.toDouble(),
            icon = iconPlaceable.width.toDouble(),
            spacing = spacing.toDouble(),
            title = titlePlaceable.width.toDouble(),
            reveal = reveal,
        ).roundToInt()
        layout(width, height) {
            iconPlaceable.place(leading, (height - iconPlaceable.height) / 2)
            titlePlaceable.placeWithLayer(leading + iconPlaceable.width + spacing.roundToInt(), (height - titlePlaceable.height) / 2) {
                alpha = reveal.toFloat()
            }
        }
    }
}

@Composable
internal fun TabCardContent(tab: BrowserTab, image: ImageBitmap?, title: String, host: String) {
    val dark = LocalArdiaDarkTheme.current
    val background = when {
        tab.isPrivate -> TabsPalette.incognitoCard
        else -> parseHexColor(tab.themeColorHex) ?: SystemPalette.background.resolve(dark)
    }
    val appear = remember(tab.id) { Animatable(if (image != null) 1f else 0f) }
    val hasImage = image != null
    LaunchedEffect(hasImage) { if (hasImage) appear.animateTo(1f, TabsMotion.fade.spec()) }
    Box(Modifier.fillMaxSize().background(background)) {
        if (image == null || appear.value < 1f) {
            if (tab.isPrivate) IncognitoCardPlaceholder(title) else PageCardPlaceholder(tab, title, host)
        }
        if (image != null) {
            Image(
                image,
                contentDescription = null,
                modifier = Modifier.fillMaxSize().graphicsLayer { alpha = appear.value },
                contentScale = ContentScale.FillWidth,
                alignment = Alignment.TopCenter,
            )
        }
    }
}

@Composable
private fun rememberSnapshot(model: AppModel, tab: BrowserTab): ImageBitmap? {
    val memory = model.deck.memoryImage(tab.id)
    val version = model.snapshotVersion(tab.id)
    val current by rememberUpdatedState(tab)
    var image by remember(tab.id) { mutableStateOf(memory?.asImageBitmap()) }
    LaunchedEffect(tab.id, tab.snapshotFileName, version, memory) {
        if (memory != null) {
            image = memory.asImageBitmap()
            return@LaunchedEffect
        }
        val loaded = model.snapshotImage(current) ?: return@LaunchedEffect
        loaded.prepareToDraw()
        image = loaded.asImageBitmap()
    }
    return image
}

@Composable
private fun PageCardPlaceholder(tab: BrowserTab, title: String, host: String) {
    val dark = LocalArdiaDarkTheme.current
    val theme = parseHexColor(tab.themeColorHex)
    val ink: Color? = theme?.let { if (ThemeInk.isLight(tab.themeColorHex)) Color.Black else Color.White }
    val pastel = remember(tab.url, dark) { ardiaColor(PlaceholderTint.hex(tab.url, dark)) }
    Column(
        Modifier.fillMaxSize().background(theme ?: pastel).padding(16.dp).padding(top = 48.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FaviconImage(tab.faviconUrl, tab.url, size = 32.dp)
        Text(title, style = ArdiaType.headline, color = ink ?: SystemPalette.label.resolve(dark), maxLines = 4, overflow = TextOverflow.Ellipsis)
        Text(
            host,
            style = ArdiaType.subheadline,
            color = ink?.copy(alpha = 0.7f) ?: SystemPalette.secondaryLabel.resolve(dark),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun IncognitoCardPlaceholder(title: String) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IncognitoGlyph(44.dp)
        Text(stringResource(R.string.tabs_incognito_tab), style = ArdiaType.footnote.semibold, color = Color.White.copy(alpha = 0.85f))
        Text(title, style = ArdiaType.caption, color = Color.White.copy(alpha = 0.55f), maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
internal fun IncognitoGlyph(size: Dp, modifier: Modifier = Modifier) {
    val pupil = TabsPalette.incognitoCard
    Canvas(modifier.size(size).clearAndSetSemantics {}) {
        val side = this.size.minDimension
        val eyeWidth = side * 0.2f
        val eyeHeight = side * 0.42f
        val gap = side * 0.12f
        val left = (side - eyeWidth * 2 - gap) / 2
        val top = (side - eyeHeight) / 2
        val pupilRadius = side * 0.13f / 2
        for (eye in 0..1) {
            val x = left + eye * (eyeWidth + gap)
            drawRoundRect(Color.White, Offset(x, top), Size(eyeWidth, eyeHeight), CornerRadius(eyeWidth / 2, eyeWidth / 2))
            drawCircle(pupil, pupilRadius, Offset(x + eyeWidth / 2, top + eyeHeight - side * 0.04f - pupilRadius))
        }
    }
}

@Composable
private fun ReceivedBadge(modifier: Modifier = Modifier) {
    val dark = LocalArdiaDarkTheme.current
    val fill = TabsPalette.receivedBadge.resolve(dark)
    val ink = Palette.onPrimaryAction.resolve(dark)
    Row(
        modifier
            .shadow(6.dp, CircleShape, ambientColor = fill.copy(alpha = 0.35f), spotColor = fill.copy(alpha = 0.35f))
            .background(fill, CircleShape)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(ArdiaSymbols.macbook, null, Modifier.size(12.dp), tint = ink)
        Text(stringResource(R.string.tabs_from_your_mac), style = ArdiaType.caption2.semibold, color = ink)
    }
}

@Composable
internal fun CardMenu(model: AppModel, tab: BrowserTab, dismiss: () -> Unit, close: () -> Unit, copied: () -> Unit) {
    if (model.shareUrl(tab) != null) {
        MenuRow(stringResource(R.string.tabs_copy_link), ArdiaSymbols.link) {
            dismiss()
            model.copyLink(tab)
            copied()
        }
        MenuRow(stringResource(R.string.tabs_share), ArdiaSymbols.squareAndArrowUp) {
            dismiss()
            model.share(tab)
        }
        for (device in model.sendTargets(tab)) {
            MenuRow(stringResource(R.string.tabs_send_to, device.name), Toasts.deviceIcon(device.name)) {
                dismiss()
                model.send(tab, device)
            }
        }
        if (!tab.isPrivate && model.syncState.isEnabled) {
            MenuRow(stringResource(R.string.tabs_pin_to_mac), ArdiaSymbols.star) {
                dismiss()
                model.pinToMac(tab)
            }
        }
        HorizontalDivider()
    }
    MenuRow(stringResource(R.string.tabs_close_tab), ArdiaSymbols.xmark, destructive = true, action = close)
}

@Composable
internal fun MenuRow(title: String, icon: ImageVector?, destructive: Boolean = false, enabled: Boolean = true, action: () -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    val color = if (destructive) SystemPalette.red.resolve(dark) else SystemPalette.label.resolve(dark)
    DropdownMenuItem(
        text = { Text(title, style = ArdiaType.body, color = color) },
        onClick = action,
        enabled = enabled,
        trailingIcon = icon?.let { { Icon(it, null, Modifier.size(18.dp), tint = color) } },
    )
}

internal const val DECK_CARD_TAG = "tabs.deck.card"

internal val ShownSnapshot = SemanticsPropertyKey<ImageBitmap?>("ShownSnapshot")
private const val HEADER_HEIGHT = 20.0
private const val HEADER_MAX_FONT_SCALE = 1.35f
