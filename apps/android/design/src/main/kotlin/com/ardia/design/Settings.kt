package com.ardia.design

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

object SettingsChrome {
    val topBarColor: Color
        @Composable get() = LocalProfileLook.current.surface.current
}

object SettingsLayout {
    val groupRadius = 26.dp
    val rowMinHeight = 52.dp
    val rowInset = 16.dp
    val labelGap = 16.dp
    val heroScrollThreshold = 150.dp
    val stepBadge = 26.dp
    const val tileMaxScale = 1.6f
    const val appIconMaxScale = 1.4f
}

@Composable
private fun scaled(base: Dp, limit: Float): Dp = base * minOf(LocalDensity.current.fontScale, limit)

@Composable
fun SettingsIconTile(icon: ImageVector, color: Color, modifier: Modifier = Modifier, baseSide: Dp = SettingsTile.side) {
    val side = scaled(baseSide, SettingsLayout.tileMaxScale)
    Box(
        modifier
            .size(side)
            .clip(RoundedCornerShape(side * 0.26f))
            .background(color.ardiaGradient())
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(side * 0.62f), tint = Color.White)
    }
}

@Composable
fun SettingsRowLabel(title: String, icon: ImageVector, tint: Color, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(SettingsLayout.labelGap), verticalAlignment = Alignment.CenterVertically) {
        SettingsIconTile(icon, tint)
        Text(title, style = ArdiaType.body, color = SystemPalette.label.current)
    }
}

@Composable
fun SettingsHero(
    title: String,
    subtitle: String,
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier,
    accessory: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(start = Spacing.page, end = Spacing.page, bottom = Spacing.hairline),
        verticalArrangement = Arrangement.spacedBy(Spacing.small),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        SettingsIconTile(icon, tint, baseSide = SettingsTile.heroSide)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.hairline), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                title,
                style = ArdiaType.title2.bold,
                color = SystemPalette.label.current,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Crossfade(subtitle, animationSpec = Motion.surfaceFade.spec(), label = "heroSubtitle") { text ->
                Text(text, style = ArdiaType.subheadline, color = SystemPalette.secondaryLabel.current, textAlign = TextAlign.Center)
            }
        }
        accessory?.invoke()
    }
}

@Composable
fun SettingsGroup(modifier: Modifier = Modifier, header: String? = null, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(horizontal = Spacing.page)) {
        if (header != null) {
            Text(
                header,
                style = ArdiaType.footnote,
                color = SystemPalette.secondaryLabel.current,
                modifier = Modifier.padding(start = SettingsLayout.rowInset, bottom = Spacing.tight).semantics { heading() },
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(SettingsLayout.groupRadius))
                .background(SystemPalette.secondaryGroupedBackground.current),
            content = content,
        )
        if (footer != null) {
            Text(
                footer,
                style = ArdiaType.footnote,
                color = SystemPalette.secondaryLabel.current,
                modifier = Modifier.padding(start = SettingsLayout.rowInset, end = SettingsLayout.rowInset, top = Spacing.tight),
            )
        }
    }
}

@Composable
fun SettingsRow(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    showsDivider: Boolean = false,
    dividerInset: Dp = SettingsLayout.rowInset + SettingsTile.side + SettingsLayout.labelGap,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable RowScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = SettingsLayout.rowMinHeight)
                .let { if (onClick != null) it.clickable(onClick = onClick) else it }
                .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, content = content)
            if (trailing != null) {
                Spacer(Modifier.size(Spacing.tight))
                Row(verticalAlignment = Alignment.CenterVertically, content = trailing)
            }
        }
        if (showsDivider) HorizontalDivider(Modifier.padding(start = dividerInset), thickness = 0.5.dp, color = SystemPalette.separator.current)
    }
}

enum class SetupStepProgress {
    Done,
    Current,
    Upcoming,
    ;

    companion object {
        fun step(done: Boolean, after: Boolean): SetupStepProgress = if (done) Done else if (after) Current else Upcoming
    }
}

@Composable
fun SetupStepRow(
    number: Int,
    title: String,
    detail: String,
    progress: SetupStepProgress,
    modifier: Modifier = Modifier,
    content: (@Composable () -> Unit)? = null,
) {
    val badge = scaled(SettingsLayout.stepBadge, Float.MAX_VALUE)
    val fill by animateColorAsState(
        targetValue = when (progress) {
            SetupStepProgress.Done -> SystemPalette.green.current
            SetupStepProgress.Current -> Palette.formAccent.current
            SetupStepProgress.Upcoming -> SystemPalette.tertiaryFill.current
        },
        animationSpec = Motion.snappy.spec(),
        label = "stepFill",
    )
    val description = when (progress) {
        SetupStepProgress.Done -> stringResource(R.string.ardia_step_done, number)
        SetupStepProgress.Current -> stringResource(R.string.ardia_step_current, number)
        SetupStepProgress.Upcoming -> stringResource(R.string.ardia_step_upcoming, number)
    }
    Row(
        modifier.padding(vertical = Spacing.hairline).semantics(mergeDescendants = false) { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(badge).background(fill, CircleShape).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
            AnimatedContent(
                targetState = progress == SetupStepProgress.Done,
                transitionSpec = {
                    val enter = scaleIn(Motion.snappy.spec()) + fadeIn(Motion.snappy.spec())
                    enter togetherWith (scaleOut(Motion.snappy.spec()) + fadeOut(Motion.snappy.spec()))
                },
                label = "stepBadge",
            ) { done ->
                if (done) {
                    Icon(ArdiaSymbols.checkmark, null, Modifier.size(badge * 0.5f), tint = Color.White)
                } else {
                    Text(
                        number.toString(),
                        style = ArdiaType.subheadline.semibold.monospacedDigits,
                        color = if (progress == SetupStepProgress.Current) Color.White else SystemPalette.secondaryLabel.current,
                    )
                }
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
            Text(
                title,
                style = ArdiaType.body.semibold,
                color = if (progress == SetupStepProgress.Upcoming) SystemPalette.secondaryLabel.current else SystemPalette.label.current,
            )
            Text(detail, style = ArdiaType.subheadline, color = SystemPalette.secondaryLabel.current)
            if (content != null) Box(Modifier.padding(top = Spacing.hairline)) { content() }
        }
    }
}

@Composable
fun AppIconPreview(painter: Painter, modifier: Modifier = Modifier, side: Dp = SettingsTile.side) {
    val scaledSide = scaled(side, SettingsLayout.appIconMaxScale)
    val shape = RoundedCornerShape(scaledSide * 0.225f)
    Image(
        painter,
        null,
        modifier
            .size(scaledSide)
            .clip(shape)
            .border(0.5.dp, SystemPalette.label.current.copy(alpha = 0.08f), shape),
    )
}

@Composable
fun SettingsSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val green = SystemPalette.green.current
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        colors = SwitchDefaults.colors(
            checkedTrackColor = green,
            checkedThumbColor = Color.White,
            checkedBorderColor = green,
            uncheckedTrackColor = SystemPalette.tertiaryFill.current,
            uncheckedThumbColor = Color.White,
            uncheckedBorderColor = Color.Transparent,
        ),
    )
}

@Composable
fun rememberSettingsHeroHidden(state: LazyListState): State<Boolean> {
    val threshold = with(LocalDensity.current) { SettingsLayout.heroScrollThreshold.roundToPx() }
    return remember(state, threshold) {
        derivedStateOf { state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > threshold }
    }
}

@Composable
fun rememberSettingsHeroHidden(state: ScrollState): State<Boolean> {
    val threshold = with(LocalDensity.current) { SettingsLayout.heroScrollThreshold.roundToPx() }
    return remember(state, threshold) { derivedStateOf { state.value > threshold } }
}
