package com.ardia.browser.android.share

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ardia.browser.android.R
import com.ardia.browser.android.system.SystemDevice
import com.ardia.design.ArdiaLogoMark
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaThemeState
import com.ardia.design.ArdiaType
import com.ardia.design.BrowsePalette
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.design.Palette
import com.ardia.design.Radius
import com.ardia.design.Spacing
import com.ardia.design.adaptive
import com.ardia.design.ardiaColor
import com.ardia.design.semibold

object SharePalette {
    val group = adaptive(Color.White, ardiaColor(0x2C2C2E))
    val scrim = Color.Black.copy(alpha = 0.32f)
    val rowPressed = adaptive(Color.Black.copy(alpha = 0.05f), Color.White.copy(alpha = 0.08f))
}

object ShareTags {
    const val CARD = "share.card"
    const val OPEN = "share.open"
    const val CLOSE = "share.close"
    const val TARGET = "share.target"
    const val DONE = "share.done"
}

@Composable
fun ShareSheetView(model: ShareSheetModel) {
    val reduceMotion = LocalReduceMotion.current
    val presented = remember { MutableTransitionState(false).apply { targetState = true } }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(model.completions) { if (model.completions > 0) haptics.performHapticFeedback(HapticFeedbackType.Confirm) }
    LaunchedEffect(model.failures) { if (model.failures > 0) haptics.performHapticFeedback(HapticFeedbackType.Reject) }
    BackHandler(onBack = model.cancel)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(presented, enter = fadeIn(Motion.smooth.spec()), exit = fadeOut()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(SharePalette.scrim)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = model.cancel),
            )
        }
        AnimatedVisibility(
            presented,
            enter = if (reduceMotion) fadeIn(Motion.reducedFade.spec()) else slideInVertically(Motion.smooth.spec()) { it },
            exit = fadeOut(),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(top = Spacing.section * 2)
                    .clip(RoundedCornerShape(topStart = Radius.sheet, topEnd = Radius.sheet))
                    .background(ArdiaThemeState.look.surface.current)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                    .verticalScroll(rememberScrollState())
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(horizontal = Spacing.page, vertical = Spacing.medium)
                    .testTag(ShareTags.CARD),
                verticalArrangement = Arrangement.spacedBy(Spacing.medium),
            ) {
                ShareHeader(model)
                AnimatedContent(
                    targetState = model.phase,
                    contentKey = { it::class },
                    transitionSpec = {
                        if (reduceMotion) fadeIn() togetherWith fadeOut() else (fadeIn(Motion.snappy.spec()) + scaleIn(Motion.snappy.spec(), 0.92f)) togetherWith fadeOut()
                    },
                    label = "share-phase",
                ) { phase ->
                    when (phase) {
                        ShareSheetModel.Phase.Ready -> if (model.hasContent) ShareActions(model) else NothingToShare()
                        is ShareSheetModel.Phase.Sending -> Box(Modifier.fillMaxWidth().heightIn(min = 160.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                        is ShareSheetModel.Phase.Done -> Confirmation(phase)
                    }
                }
            }
        }
    }
}

@Composable
private fun ShareHeader(model: ShareSheetModel) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        ArdiaLogoMark(Modifier.size(width = 40.dp, height = 32.dp))
        Column(Modifier.weight(1f)) {
            Text(
                model.page.displayTitle.ifEmpty { stringResource(R.string.app_name) },
                style = ArdiaType.headline,
                color = BrowsePalette.foregroundPrimary.current,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            model.page.host?.let {
                Text(it, style = ArdiaType.subheadline, color = BrowsePalette.foregroundSecondary.current, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        val close = stringResource(R.string.share_close)
        Box(
            Modifier
                .size(30.dp)
                .clip(CircleShape)
                .background(BrowsePalette.fieldFill.current)
                .clickable(onClickLabel = close, role = Role.Button, onClick = model.cancel)
                .testTag(ShareTags.CLOSE),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ArdiaSymbols.xmark, contentDescription = close, modifier = Modifier.size(14.dp), tint = BrowsePalette.foregroundSecondary.current)
        }
    }
}

@Composable
private fun ShareActions(model: ShareSheetModel) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.medium)) {
        ShareGroup {
            ShareRow(
                title = stringResource(if (model.opensPage) R.string.share_open_in_ardia else R.string.share_search_in_ardia),
                icon = if (model.opensPage) ArdiaSymbols.arrowUpForwardAppFill else ArdiaSymbols.magnifyingglass,
                modifier = Modifier.testTag(ShareTags.OPEN),
                onClick = model::openInArdia,
            )
        }
        val targets = model.sendTargets
        if (targets.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.tight)) {
                Text(
                    stringResource(if (model.sendsOnlyToMacs) R.string.share_send_to_your_mac else R.string.share_send_to_your_devices),
                    style = ArdiaType.footnote.semibold,
                    color = BrowsePalette.foregroundSecondary.current,
                    modifier = Modifier.padding(start = Spacing.page).semantics { heading() },
                )
                ShareGroup {
                    targets.forEachIndexed { index, device ->
                        if (index > 0) HorizontalDivider(Modifier.padding(start = ShareRowLayout.dividerInset))
                        ShareRow(device.name, deviceIcon(device), Modifier.testTag(ShareTags.TARGET)) { model.send(device) }
                    }
                }
            }
        } else if (model.offersSyncHint) {
            Text(
                stringResource(R.string.share_sync_hint),
                style = ArdiaType.footnote,
                color = BrowsePalette.foregroundSecondary.current,
                modifier = Modifier.padding(horizontal = Spacing.page),
            )
        }
    }
}

private fun deviceIcon(device: SystemDevice): ImageVector = if (device.isMac) ArdiaSymbols.laptopcomputer else ArdiaSymbols.iphone

object ShareRowLayout {
    val tile = 30.dp
    val dividerInset = Spacing.page + tile + Spacing.small
}

@Composable
private fun ShareGroup(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.card)).background(SharePalette.group.current)) { content() }
}

@Composable
private fun ShareRow(title: String, icon: ImageVector, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Spacing.page, vertical = Spacing.small),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(ShareRowLayout.tile).clip(RoundedCornerShape(8.dp)).background(Palette.formAccent.current),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(15.dp), tint = Color.White)
        }
        Spacer(Modifier.width(Spacing.small))
        Text(title, style = ArdiaType.body, color = BrowsePalette.foregroundPrimary.current, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun NothingToShare() {
    Box(Modifier.fillMaxWidth().heightIn(min = 120.dp), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.share_nothing), style = ArdiaType.body, color = BrowsePalette.foregroundSecondary.current, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Confirmation(phase: ShareSheetModel.Phase.Done) {
    val message = when (val text = phase.message) {
        is ShareSheetModel.Message.Sent -> stringResource(R.string.share_sent_to, text.deviceName)
        is ShareSheetModel.Message.CouldNotSend -> stringResource(R.string.share_could_not_send, text.deviceName)
        ShareSheetModel.Message.CouldNotOpen -> stringResource(R.string.share_could_not_open)
    }
    Column(
        Modifier.fillMaxWidth().heightIn(min = 160.dp).testTag(ShareTags.DONE),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.small, Alignment.CenterVertically),
    ) {
        Icon(
            if (phase.succeeded) ArdiaSymbols.checkmarkCircleFill else ArdiaSymbols.exclamationmarkTriangleFill,
            contentDescription = null,
            modifier = Modifier.size(44.dp),
            tint = if (phase.succeeded) Palette.success.current else BrowsePalette.findError,
        )
        Text(message, style = ArdiaType.headline, color = BrowsePalette.foregroundPrimary.current, textAlign = TextAlign.Center)
    }
}
