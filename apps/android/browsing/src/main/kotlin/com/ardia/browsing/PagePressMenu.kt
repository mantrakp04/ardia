package com.ardia.browsing

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.browser.PressTarget
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.SystemPalette
import kotlin.math.roundToInt

enum class PressAction { OpenInNewTab, OpenInBackground, CopyLink, Share, Download, SaveImage }

object PressMenuItems {
    fun of(target: PressTarget): List<List<PressAction>> = when (target) {
        is PressTarget.Link -> listOf(
            listOf(PressAction.OpenInNewTab, PressAction.OpenInBackground),
            listOf(PressAction.CopyLink, PressAction.Share, PressAction.Download),
        )
        is PressTarget.Image -> if (target.linkUrl != null) {
            listOf(
                listOf(PressAction.OpenInNewTab, PressAction.OpenInBackground),
                listOf(PressAction.CopyLink, PressAction.Share, PressAction.Download),
                listOf(PressAction.SaveImage),
            )
        } else {
            listOf(
                listOf(PressAction.OpenInNewTab, PressAction.OpenInBackground),
                listOf(PressAction.CopyLink, PressAction.Share, PressAction.SaveImage),
            )
        }
    }

    fun linkUrl(target: PressTarget): String = when (target) {
        is PressTarget.Link -> target.url
        is PressTarget.Image -> target.linkUrl ?: target.url
    }

    fun heading(target: PressTarget): String = when (target) {
        is PressTarget.Link -> target.text ?: target.url
        is PressTarget.Image -> target.linkUrl ?: target.url
    }
}

@Composable
internal fun PagePressMenu(model: AppModel, press: BrowseSession.PagePress) {
    val view = LocalView.current
    LaunchedEffect(press) { view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS) }
    val dismiss = { if (model.browse.press == press) model.browse.press = null }
    val target = press.target
    val link = PressMenuItems.linkUrl(target)
    Box(Modifier.offset { IntOffset(press.x.roundToInt(), press.y.roundToInt()) }.size(1.dp)) {
        DropdownMenu(expanded = true, onDismissRequest = dismiss, modifier = Modifier.testTag(BrowsingTags.PRESS_MENU).widthIn(max = 300.dp)) {
            Text(
                PressMenuItems.heading(target),
                style = ArdiaType.footnote,
                color = SystemPalette.secondaryLabel.current,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp).widthIn(max = 260.dp),
            )
            for (group in PressMenuItems.of(target)) {
                HorizontalDivider()
                for (action in group) {
                    val (title, icon) = pressLabel(action)
                    DropdownMenuItem(
                        text = { Text(title) },
                        leadingIcon = { Icon(icon, null, Modifier.size(18.dp)) },
                        onClick = {
                            dismiss()
                            when (action) {
                                PressAction.OpenInNewTab -> model.openLink(link, press.tabId, inBackground = false)
                                PressAction.OpenInBackground -> model.openLink(link, press.tabId, inBackground = true)
                                PressAction.CopyLink -> model.copyLink(link)
                                PressAction.Share -> model.share(link, "")
                                PressAction.Download -> model.page(press.tabId)?.download(link)
                                PressAction.SaveImage -> model.page(press.tabId)?.download(target.url)
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun pressLabel(action: PressAction): Pair<String, ImageVector> = when (action) {
    PressAction.OpenInNewTab -> stringResource(R.string.browsing_open_in_new_tab) to BrowsingSymbols.plusSquareOnSquare
    PressAction.OpenInBackground -> stringResource(R.string.browsing_open_in_background) to ArdiaSymbols.squareOnSquare
    PressAction.CopyLink -> stringResource(R.string.browsing_copy_link) to ArdiaSymbols.link
    PressAction.Share -> stringResource(R.string.browsing_share_ellipsis) to ArdiaSymbols.squareAndArrowUp
    PressAction.Download -> stringResource(R.string.browsing_download_linked_file) to BrowsingSymbols.arrowDownCircle
    PressAction.SaveImage -> stringResource(R.string.browsing_save_image) to BrowsingSymbols.arrowDownCircle
}
