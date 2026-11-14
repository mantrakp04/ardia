package com.ardia.browsing

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.SettingsRoute
import com.ardia.browser.Page
import com.ardia.browser.PageZoom
import com.ardia.design.ArdiaColors
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.MenuLayout
import com.ardia.design.Motion
import com.ardia.design.SettingsGroup
import com.ardia.design.SettingsRow
import com.ardia.design.SettingsRowLabel
import com.ardia.design.SettingsSwitch
import com.ardia.design.SettingsTint
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.medium
import com.ardia.design.monospacedDigits
import com.ardia.design.semibold
import com.ardia.store.BrowserTab
import com.ardia.store.BrowserUrl
import com.ardia.store.NightShadeMode
import com.ardia.store.SwipeNavigationMode
import com.ardia.sync.SyncedDevice

internal object MenuTags {
    const val BACK = "menu.back"
    const val FORWARD = "menu.forward"
    const val TITLE = "menu.title"
    const val PIN = "menu.pin"
    const val RELOAD = "menu.reload"
    const val READER = "menu.reader"
    const val COPY = "menu.copy"
    const val SHARE = "menu.share"
    const val FIND = "menu.find"
    const val SEND = "menu.send"
    const val TRANSLATE = "menu.translate"
    const val NIGHT_SHADE = "menu.nightShade"
    const val ZOOM = "menu.zoom"
    const val ZOOM_OUT = "menu.zoomOut"
    const val ZOOM_IN = "menu.zoomIn"
    const val ZOOM_RESET = "menu.zoomReset"
    const val DESKTOP = "menu.desktop"
    const val BLOCKING = "menu.blocking"
    const val DEFAULT_BROWSER = "menu.defaultBrowser"
    const val SITE_SETTINGS = "menu.siteSettings"
}

private val iconSlot = 26.dp

@Composable
private fun isLargeText(): Boolean = LocalDensity.current.fontScale >= 1.3f

@Composable
internal fun PageMenu(
    model: AppModel,
    tab: BrowserTab,
    page: Page?,
    showsSiteSettings: Boolean,
    onShowSiteSettings: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    AnimatedContent(
        targetState = showsSiteSettings,
        transitionSpec = { fadeIn(Motion.surfaceFade.spec()) togetherWith fadeOut(Motion.surfaceFade.spec()) },
        label = "pageMenu",
    ) { siteSettings ->
        if (siteSettings) {
            SiteSettingsPage(model, onBack = { onShowSiteSettings(false) })
        } else {
            PageMenuMain(model, tab, page, onShowSiteSettings = { onShowSiteSettings(true) }, onDismiss = onDismiss)
        }
    }
}

@Composable
private fun PageMenuMain(model: AppModel, tab: BrowserTab, page: Page?, onShowSiteSettings: () -> Unit, onDismiss: () -> Unit) {
    val isWebPage = BrowserUrl.isSyncable(tab.url)
    val large = isLargeText()
    var confirmsTranslation by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(scroll, enabled = scroll.maxValue > 0)
            .padding(MenuLayout.inset)
            .padding(bottom = if (large) Spacing.large else 0.dp),
        verticalArrangement = Arrangement.spacedBy(MenuLayout.inset),
    ) {
        NavigationCapsule(model, tab, page, isWebPage, large, onDismiss)
        Tiles(model, tab, isWebPage, large, onDismiss)
        if (page != null) {
            MenuGroup {
                FindRow(model, isWebPage)
                SendRow(model, tab, isWebPage, onDismiss)
                MenuRow(BrowsingSymbols.translate, stringResource(R.string.browsing_translate), MenuTags.TRANSLATE, enabled = isWebPage, divider = false) {
                    confirmsTranslation = true
                }
            }
            MenuGroup {
                NightShadeRow(model, page, isWebPage)
                ZoomRow(page, isWebPage, large)
                DesktopRow(model, page, isWebPage, onDismiss)
            }
            MenuGroup {
                BlockingRow(model, page, isWebPage, onDismiss)
                val offersDefaultBrowser = !model.defaultBrowser.isDefault
                MenuRow(
                    ArdiaSymbols.gearshape,
                    stringResource(R.string.browsing_site_settings),
                    MenuTags.SITE_SETTINGS,
                    divider = offersDefaultBrowser,
                    onClick = onShowSiteSettings,
                )
                if (offersDefaultBrowser) {
                    MenuRow(ArdiaSymbols.safariFill, stringResource(R.string.browsing_open_in_default_browser), MenuTags.DEFAULT_BROWSER, divider = false) {
                        model.openInDefaultBrowser(page)
                        onDismiss()
                    }
                }
            }
        } else {
            MenuGroup { FindRow(model, isWebPage, divider = false) }
        }
    }
    if (confirmsTranslation) {
        AlertDialog(
            onDismissRequest = { confirmsTranslation = false },
            title = { Text(stringResource(R.string.browsing_translate_title)) },
            text = { Text(stringResource(R.string.browsing_translate_message)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmsTranslation = false
                    page?.let(model::translate)
                    onDismiss()
                }) { Text(stringResource(R.string.browsing_translate)) }
            },
            dismissButton = { TextButton(onClick = { confirmsTranslation = false }) { Text(stringResource(R.string.browsing_cancel)) } },
        )
    }
}

@Composable
private fun NavigationCapsule(model: AppModel, tab: BrowserTab, page: Page?, isWebPage: Boolean, large: Boolean, onDismiss: () -> Unit) {
    val canGoBack = page?.select { it.canGoBack }?.value ?: false
    val canGoForward = page?.select { it.canGoForward }?.value ?: false
    val isLoading = page?.select { it.isLoading }?.value ?: false
    val shape = if (large) RoundedCornerShape(MenuLayout.innerRadius) else CircleShape
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(SystemPalette.secondaryGroupedBackground.current)
            .padding(horizontal = Spacing.hairline),
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = MenuLayout.capsuleHeight), verticalAlignment = Alignment.CenterVertically) {
            CapsuleButton(ArdiaSymbols.chevronLeft, stringResource(R.string.browsing_back), MenuTags.BACK, canGoBack) {
                page?.goBack()
                onDismiss()
            }
            CapsuleButton(ArdiaSymbols.chevronRight, stringResource(R.string.browsing_forward), MenuTags.FORWARD, canGoForward) {
                page?.goForward()
                onDismiss()
            }
            if (large) Spacer(Modifier.weight(1f)) else TitleLabel(model, tab, page, singleLine = true, Modifier.weight(1f))
            CapsuleButton(ArdiaSymbols.star, stringResource(R.string.browsing_pin_to_mac), MenuTags.PIN, isWebPage && !tab.isPrivate) {
                model.pinCurrentToMac()
            }
            if (isLoading) {
                CapsuleButton(ArdiaSymbols.xmark, stringResource(R.string.browsing_stop), MenuTags.RELOAD, true) { page?.stop() }
            } else {
                CapsuleButton(ArdiaSymbols.arrowClockwise, stringResource(R.string.browsing_reload), MenuTags.RELOAD, isWebPage) {
                    page?.reload()
                    onDismiss()
                }
            }
        }
        if (large) {
            HorizontalDivider(Modifier.padding(horizontal = Spacing.page), thickness = 0.5.dp, color = SystemPalette.separator.current)
            TitleLabel(model, tab, page, singleLine = false, Modifier.padding(horizontal = Spacing.tight, vertical = Spacing.small))
        }
    }
}

@Composable
private fun TitleLabel(model: AppModel, tab: BrowserTab, page: Page?, singleLine: Boolean, modifier: Modifier) {
    val feedback = model.browse.titleFeedback
    val host = page?.select { it.host }?.value ?: BrowserUrl.host(tab.url)
    val title = PageMenuText.title(tab, model.currentQuery(tab), host)
    val hint = stringResource(R.string.browsing_edits_search)
    Box(
        modifier
            .testTag(MenuTags.TITLE)
            .padding(horizontal = Spacing.hairline)
            .clickable(onClickLabel = hint) { model.editQuery(tab) }
            .semantics {
                contentDescription = feedback ?: title
                role = Role.Button
            },
        contentAlignment = if (singleLine) Alignment.Center else Alignment.CenterStart,
    ) {
        AnimatedContent(targetState = feedback, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "titleFeedback") { shown ->
            if (shown != null) {
                Text(
                    shown,
                    style = ArdiaType.body.semibold,
                    color = ArdiaColors.accentText.current,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                Text(
                    title,
                    style = ArdiaType.body,
                    color = SystemPalette.label.current,
                    maxLines = if (singleLine) 1 else 3,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = if (singleLine) TextAlign.Center else TextAlign.Start,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun CapsuleButton(icon: ImageVector, label: String, tag: String, enabled: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .testTag(tag)
            .widthIn(min = 44.dp)
            .heightIn(min = MenuLayout.capsuleHeight)
            .graphicsLayer {
                val scale = if (pressed) 0.94f else 1f
                scaleX = scale
                scaleY = scale
            }
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(19.dp), tint = if (enabled) SystemPalette.label.current else SystemPalette.tertiaryLabel.current)
    }
}

private class TileItem(val icon: ImageVector, val title: String, val tag: String, val action: () -> Unit)

@Composable
private fun Tiles(model: AppModel, tab: BrowserTab, isWebPage: Boolean, large: Boolean, onDismiss: () -> Unit) {
    val view = LocalView.current
    val items = listOf(
        TileItem(ArdiaSymbols.docPlaintext, stringResource(R.string.browsing_reader), MenuTags.READER) {
            model.browse.isToolbarPresented = false
            model.showReader(tab.id)
        },
        TileItem(ArdiaSymbols.link, stringResource(R.string.browsing_copy_link), MenuTags.COPY) {
            if (model.copyCurrentLink()) {
                view.performHapticFeedback(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
            }
        },
        TileItem(ArdiaSymbols.squareAndArrowUp, stringResource(R.string.browsing_share), MenuTags.SHARE) {
            onDismiss()
            model.shareCurrentPage()
        },
    )
    if (large) {
        MenuGroup {
            for (item in items) MenuRow(item.icon, item.title, item.tag, enabled = isWebPage, onClick = item.action)
        }
        return
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.tight)) {
        for (item in items) Tile(item, isWebPage)
    }
}

@Composable
private fun RowScope.Tile(item: TileItem, enabled: Boolean) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val ink = if (enabled) SystemPalette.label.current else SystemPalette.tertiaryLabel.current
    Column(
        Modifier
            .testTag(item.tag)
            .weight(1f)
            .graphicsLayer {
                val scale = if (pressed) 0.94f else 1f
                scaleX = scale
                scaleY = scale
            }
            .clip(RoundedCornerShape(MenuLayout.innerRadius))
            .background(SystemPalette.secondaryGroupedBackground.current)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = item.action)
            .heightIn(min = MenuLayout.tileHeight)
            .padding(vertical = Spacing.small),
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(item.icon, null, Modifier.size(22.dp), tint = ink)
        Text(item.title, style = ArdiaType.footnote.medium, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun MenuGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(MenuLayout.innerRadius))
            .background(SystemPalette.secondaryGroupedBackground.current),
        content = content,
    )
}

@Composable
private fun MenuDivider() {
    HorizontalDivider(Modifier.padding(start = Spacing.page + iconSlot + Spacing.small), thickness = 0.5.dp, color = SystemPalette.separator.current)
}

@Composable
private fun RowIcon(icon: ImageVector) {
    Box(Modifier.width(iconSlot), contentAlignment = Alignment.Center) {
        Icon(icon, null, Modifier.size(20.dp), tint = SystemPalette.secondaryLabel.current)
    }
}

@Composable
private fun MenuRow(
    icon: ImageVector,
    title: String,
    tag: String,
    enabled: Boolean = true,
    divider: Boolean = true,
    accessory: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    Column {
        Row(
            Modifier
                .testTag(tag)
                .fillMaxWidth()
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .heightIn(min = MenuLayout.rowHeight)
                .padding(horizontal = Spacing.page),
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RowIcon(icon)
            Text(
                title,
                style = ArdiaType.body,
                color = if (enabled) SystemPalette.label.current else SystemPalette.tertiaryLabel.current,
                modifier = Modifier.weight(1f).padding(vertical = Spacing.tight),
            )
            accessory?.invoke()
        }
        if (divider) MenuDivider()
    }
}

@Composable
private fun ToggleRow(
    icon: ImageVector,
    title: String,
    tag: String,
    checked: Boolean,
    enabled: Boolean,
    detail: String? = null,
    detailLabel: String? = null,
    divider: Boolean = true,
    onChange: (Boolean) -> Unit,
) {
    Column {
        Row(
            Modifier
                .testTag(tag)
                .fillMaxWidth()
                .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange)
                .heightIn(min = MenuLayout.rowHeight)
                .padding(horizontal = Spacing.page),
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RowIcon(icon)
            Text(
                title,
                style = ArdiaType.body,
                color = if (enabled) SystemPalette.label.current else SystemPalette.tertiaryLabel.current,
                modifier = Modifier.weight(1f).padding(vertical = Spacing.tight),
            )
            if (detail != null) {
                Text(
                    detail,
                    style = ArdiaType.subheadline.monospacedDigits,
                    color = SystemPalette.secondaryLabel.current,
                    modifier = Modifier.semantics { contentDescription = "${detailLabel.orEmpty()} $detail".trim() },
                )
            }
            SettingsSwitch(checked = checked, onCheckedChange = null, enabled = enabled)
        }
        if (divider) MenuDivider()
    }
}

@Composable
private fun FindRow(model: AppModel, isWebPage: Boolean, divider: Boolean = true) {
    MenuRow(ArdiaSymbols.textMagnifyingglass, stringResource(R.string.browsing_find_on_page), MenuTags.FIND, enabled = isWebPage, divider = divider) {
        model.showFindOnPage()
    }
}

@Composable
private fun SendRow(model: AppModel, tab: BrowserTab, isWebPage: Boolean, onDismiss: () -> Unit) {
    val devices = model.sendTargets(tab)
    if (devices.isEmpty() || !isWebPage) return
    if (devices.size == 1) {
        val device = devices.first()
        MenuRow(BrowsingSymbols.paperplane, stringResource(R.string.browsing_send_to, device.name), MenuTags.SEND) {
            model.send(tab, device)
            onDismiss()
        }
        return
    }
    var expanded by remember { mutableStateOf(false) }
    Box {
        MenuRow(
            BrowsingSymbols.paperplane,
            stringResource(R.string.browsing_send_to_device),
            MenuTags.SEND,
            accessory = { Icon(ArdiaSymbols.chevronUpChevronDown, null, Modifier.size(14.dp), tint = SystemPalette.tertiaryLabel.current) },
        ) { expanded = true }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (device in devices) {
                DropdownMenuItem(
                    text = { Text(device.name) },
                    leadingIcon = {
                        Icon(if (device.kind == SyncedDevice.MAC) ArdiaSymbols.laptopcomputer else ArdiaSymbols.iphone, null, Modifier.size(18.dp))
                    },
                    onClick = {
                        expanded = false
                        model.send(tab, device)
                        onDismiss()
                    },
                )
            }
        }
    }
}

@Composable
private fun NightShadeRow(model: AppModel, page: Page, isWebPage: Boolean) {
    page.select { it.host }.value
    val isOn = PageMenuText.nightShadeIsOn(model.nightShade(page), LocalArdiaDarkTheme.current)
    ToggleRow(
        if (isOn) ArdiaSymbols.moonFill else BrowsingSymbols.moon,
        stringResource(R.string.browsing_night_shade),
        MenuTags.NIGHT_SHADE,
        checked = isOn,
        enabled = isWebPage,
    ) { model.setNightShade(it, page) }
}

@Composable
private fun DesktopRow(model: AppModel, page: Page, isWebPage: Boolean, onDismiss: () -> Unit) {
    val isOn = model.isDesktopSite(page)
    ToggleRow(BrowsingSymbols.desktop, stringResource(R.string.browsing_desktop_site), MenuTags.DESKTOP, checked = isOn, enabled = isWebPage, divider = false) { wanted ->
        if (wanted == model.isDesktopSite(page)) return@ToggleRow
        model.toggleDesktopSite(page)
        onDismiss()
    }
}

@Composable
private fun BlockingRow(model: AppModel, page: Page, isWebPage: Boolean, onDismiss: () -> Unit) {
    model.blockingState
    page.select { it.host }.value
    val enabled = model.blockersEnabled(page)
    val count by page.select { it.blockedRequests }
    ToggleRow(
        if (enabled) ArdiaSymbols.handRaisedFill else BrowsingSymbols.handRaisedSlash,
        stringResource(R.string.browsing_block_ads_and_trackers),
        MenuTags.BLOCKING,
        checked = enabled,
        enabled = isWebPage,
        detail = if (enabled && count > 0) "%,d".format(count) else null,
        detailLabel = stringResource(R.string.browsing_blocked),
    ) { wanted ->
        if (wanted == model.blockersEnabled(page)) return@ToggleRow
        model.toggleBlockers(page)
        onDismiss()
    }
}

@Composable
private fun ZoomRow(page: Page, isWebPage: Boolean, large: Boolean) {
    val zoom by page.select { it.pageZoom }
    val canZoomOut = zoom > PageZoom.levels.first() + 0.001
    val canZoomIn = zoom < PageZoom.levels.last() - 0.001
    val percent = PageMenuText.zoomPercent(zoom)
    val controls = @Composable {
        Row(
            Modifier.clip(CircleShape).background(SystemPalette.tertiaryFill.current),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ZoomButton(ArdiaSymbols.minus, stringResource(R.string.browsing_zoom_out), MenuTags.ZOOM_OUT, canZoomOut && isWebPage) { page.zoomOut() }
            val resetLabel = stringResource(R.string.browsing_reset_zoom)
            Box(
                Modifier
                    .testTag(MenuTags.ZOOM_RESET)
                    .widthIn(min = 48.dp)
                    .heightIn(min = 34.dp)
                    .clickable(enabled = isWebPage, role = Role.Button) { page.setPageZoom(1.0) }
                    .semantics {
                        contentDescription = resetLabel
                        stateDescription = percent
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(percent, style = ArdiaType.subheadline.semibold.monospacedDigits, color = SystemPalette.label.current)
            }
            ZoomButton(ArdiaSymbols.plus, stringResource(R.string.browsing_zoom_in), MenuTags.ZOOM_IN, canZoomIn && isWebPage) { page.zoomIn() }
        }
    }
    val label = @Composable { modifier: Modifier ->
        Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.small), verticalAlignment = Alignment.CenterVertically) {
            RowIcon(ArdiaSymbols.textformatSize)
            Text(
                stringResource(R.string.browsing_page_zoom),
                style = ArdiaType.body,
                color = if (isWebPage) SystemPalette.label.current else SystemPalette.tertiaryLabel.current,
            )
        }
    }
    Column(Modifier.testTag(MenuTags.ZOOM)) {
        if (large) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = Spacing.page, vertical = Spacing.small),
                verticalArrangement = Arrangement.spacedBy(Spacing.tight),
            ) {
                label(Modifier)
                controls()
            }
        } else {
            Row(
                Modifier.fillMaxWidth().heightIn(min = MenuLayout.rowHeight).padding(horizontal = Spacing.page),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                label(Modifier.weight(1f))
                controls()
            }
        }
        MenuDivider()
    }
}

@Composable
private fun ZoomButton(icon: ImageVector, label: String, tag: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .testTag(tag)
            .size(40.dp, 34.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(16.dp), tint = if (enabled) SystemPalette.label.current else SystemPalette.tertiaryLabel.current)
    }
}

@Composable
internal fun SiteSettingsPage(model: AppModel, onBack: () -> Unit) {
    val blocking = model.blockingState
    val browsing = model.browsing
    val large = isLargeText()
    val scroll = rememberScrollState()
    Column(
        Modifier
            .testTag(BrowsingTags.SITE_SETTINGS)
            .fillMaxWidth()
            .verticalScroll(scroll, enabled = scroll.maxValue > 0)
            .padding(vertical = MenuLayout.inset),
        verticalArrangement = Arrangement.spacedBy(Spacing.large),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.tight), verticalAlignment = Alignment.CenterVertically) {
            CapsuleButton(ArdiaSymbols.chevronLeft, stringResource(R.string.browsing_back), "siteSettings.back", true, onBack)
            Text(
                stringResource(R.string.browsing_site_settings),
                style = ArdiaType.headline,
                color = SystemPalette.label.current,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(44.dp))
        }
        SettingsGroup {
            SwitchSettingsRow(stringResource(R.string.browsing_block_ads), ArdiaSymbols.handRaisedFill, SettingsTint.ads, blocking.blocksAds, model::setBlocksAds)
            SwitchSettingsRow(stringResource(R.string.browsing_block_trackers), ArdiaSymbols.eyeglasses, SettingsTint.trackers, blocking.blocksTrackers, model::setBlocksTrackers)
            SwitchSettingsRow(
                stringResource(R.string.browsing_block_cookie_banners),
                ArdiaSymbols.listBulletRectanglePortraitFill,
                SettingsTint.cookies,
                blocking.hidesCookieBanners,
                model::setHidesCookieBanners,
            )
            SettingsRow(
                onClick = { model.openSiteSettingsRoute(SettingsRoute.FilterLists) },
                showsDivider = true,
                trailing = { ValueText(model.filterListsState.enabledLists.size.toString()) },
            ) { SettingsRowLabel(stringResource(R.string.browsing_filter_lists), BrowsingSymbols.filterLists, SettingsTint.neutral) }
            SettingsRow(
                onClick = { model.openSiteSettingsRoute(SettingsRoute.TrustedSites) },
                trailing = { ValueText(if (blocking.exemptHosts.isEmpty()) stringResource(R.string.browsing_none) else blocking.exemptHosts.size.toString()) },
            ) { SettingsRowLabel(stringResource(R.string.browsing_trusted_sites), ArdiaSymbols.checkmarkShieldFill, SettingsTint.green) }
        }
        SettingsGroup(footer = stringResource(R.string.browsing_site_settings_footer)) {
            ChoiceSettingsRow(
                stringResource(R.string.browsing_night_shade),
                ArdiaSymbols.moonFill,
                SettingsTint.nightShade,
                NightShadeMode.entries,
                browsing.nightShade,
                ::nightShadeTitle,
                model::setDefaultNightShade,
            )
            ChoiceSettingsRow(
                stringResource(R.string.browsing_swipe_to_navigate),
                ArdiaSymbols.handDrawFill,
                SettingsTint.swipe,
                SwipeNavigationMode.entries,
                browsing.swipeNavigation,
                ::swipeTitle,
                model::setSwipeNavigation,
            )
            SwitchSettingsRow(
                stringResource(R.string.browsing_collapse_bottom_bar),
                ArdiaSymbols.platterFilledBottomAndArrowDownIphone,
                SettingsTint.bottomBar,
                model.settings.collapsesBottomBar,
                divider = false,
            ) { model.settings.collapsesBottomBar = it }
        }
    }
}

@Composable
private fun nightShadeTitle(mode: NightShadeMode): String = stringResource(
    when (mode) {
        NightShadeMode.DISABLED -> R.string.browsing_night_shade_off
        NightShadeMode.AUTOMATIC -> R.string.browsing_night_shade_automatic
        NightShadeMode.ALWAYS -> R.string.browsing_night_shade_always
    },
)

@Composable
private fun swipeTitle(mode: SwipeNavigationMode): String = stringResource(
    when (mode) {
        SwipeNavigationMode.ANYWHERE -> R.string.browsing_swipe_anywhere
        SwipeNavigationMode.SCREEN_EDGES -> R.string.browsing_swipe_edges
        SwipeNavigationMode.DISABLED -> R.string.browsing_swipe_off
    },
)

@Composable
private fun ValueText(text: String) {
    Text(text, style = ArdiaType.body, color = SystemPalette.secondaryLabel.current)
    Icon(ArdiaSymbols.chevronRight, null, Modifier.padding(start = Spacing.hairline).size(13.dp), tint = SystemPalette.tertiaryLabel.current)
}

@Composable
private fun SwitchSettingsRow(
    title: String,
    icon: ImageVector,
    tint: Color,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) = SwitchSettingsRow(title, icon, tint, checked, divider = true, onChange = onChange)

@Composable
private fun SwitchSettingsRow(title: String, icon: ImageVector, tint: Color, checked: Boolean, divider: Boolean, onChange: (Boolean) -> Unit) {
    SettingsRow(
        modifier = Modifier.toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        showsDivider = divider,
        trailing = { SettingsSwitch(checked = checked, onCheckedChange = null) },
    ) { SettingsRowLabel(title, icon, tint) }
}

@Composable
private fun <T> ChoiceSettingsRow(
    title: String,
    icon: ImageVector,
    tint: Color,
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        SettingsRow(
            onClick = { expanded = true },
            showsDivider = true,
            trailing = {
                Text(label(selected), style = ArdiaType.body, color = SystemPalette.secondaryLabel.current)
                Icon(ArdiaSymbols.chevronUpChevronDown, null, Modifier.padding(start = Spacing.hairline).size(13.dp), tint = SystemPalette.tertiaryLabel.current)
            },
        ) { SettingsRowLabel(title, icon, tint) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (option in options) {
                DropdownMenuItem(
                    text = { Text(label(option)) },
                    trailingIcon = if (option == selected) ({ Icon(ArdiaSymbols.checkmark, null, Modifier.size(16.dp)) }) else null,
                    onClick = {
                        expanded = false
                        onSelect(option)
                    },
                )
            }
        }
    }
}
