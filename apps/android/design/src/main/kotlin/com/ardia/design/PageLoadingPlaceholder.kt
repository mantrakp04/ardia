package com.ardia.design

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Immutable
data class PageTheme(val color: Color, val ink: Color) {
    companion object {
        fun parse(hex: String?): PageTheme? {
            var value = hex?.trim() ?: return null
            if (value.startsWith("#")) value = value.drop(1)
            if (value.length != 6) return null
            val number = value.toLongOrNull(16) ?: return null
            val red = ((number shr 16) and 0xFF) / 255.0
            val green = ((number shr 8) and 0xFF) / 255.0
            val blue = (number and 0xFF) / 255.0
            val luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if (luminance >= 0.94) return null
            val ink = if (luminance > 0.55) Color.Black.copy(alpha = 0.85f) else Color.White.copy(alpha = 0.92f)
            return PageTheme(ardiaColor(number), ink)
        }
    }
}

object PlaceholderText {
    fun distinctTitle(title: String, host: String?, newTab: String): String? {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return if (host == null) newTab else null
        if (host == null) return trimmed
        val bare = { text: String -> text.lowercase().replace("www.", "") }
        if (bare(trimmed) == bare(host) || trimmed.lowercase().startsWith("http")) return null
        return trimmed
    }
}

@Composable
fun PageLoadingPlaceholder(
    title: String,
    url: String,
    backdrop: Color,
    modifier: Modifier = Modifier,
    faviconUrl: String? = null,
    themeColorHex: String? = null,
    accessibilityTitle: String = title,
    revealDelayMillis: Long? = null,
) {
    val theme = remember(themeColorHex) { PageTheme.parse(themeColorHex) }
    val host = remember(url) { Monogram.host(url) }
    val newTab = stringResource(R.string.ardia_new_tab)
    val shownTitle = remember(title, host, newTab) { PlaceholderText.distinctTitle(title, host, newTab) }
    val description = stringResource(R.string.ardia_loading_page, accessibilityTitle)
    val reveal = remember { Animatable(if (revealDelayMillis == null) 1f else 0f) }
    LaunchedEffect(revealDelayMillis) {
        if (revealDelayMillis == null || reveal.value == 1f) return@LaunchedEffect
        delay(revealDelayMillis)
        reveal.animateTo(1f, Motion.placeholderIn.spec())
    }
    val primary = theme?.ink ?: BrowsePalette.foregroundPrimary.current
    val secondary = theme?.ink?.copy(alpha = theme.ink.alpha * 0.65f) ?: BrowsePalette.foregroundSecondary.current
    Column(
        modifier
            .fillMaxSize()
            .background(theme?.color ?: backdrop)
            .clearAndSetSemantics { contentDescription = description }
            .padding(horizontal = Spacing.section)
            .graphicsLayer { alpha = reveal.value },
        verticalArrangement = Arrangement.spacedBy(Spacing.small, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        FaviconImage(
            iconUrl = faviconUrl,
            pageUrl = url,
            size = 44.dp,
            modifier = Modifier.dropShadow(
                RoundedCornerShape(44.dp * 0.26f),
                Shadow(radius = 6.dp, color = Color.Black.copy(alpha = 0.08f), offset = DpOffset(0.dp, 2.dp)),
            ),
        )
        if (shownTitle != null) {
            Text(shownTitle, style = ArdiaType.headline, color = primary, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        if (host != null) {
            Text(
                host,
                style = if (shownTitle == null) ArdiaType.headline else ArdiaType.subheadline,
                color = if (shownTitle == null) primary else secondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
