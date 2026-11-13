package com.ardia.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.SettingsRoute
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.Palette
import com.ardia.design.SettingsGroup
import com.ardia.design.SettingsLayout
import com.ardia.design.SettingsTint
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.bold
import com.ardia.design.semibold
import com.ardia.store.ClearRange
import com.ardia.store.NightShadeMode
import com.ardia.store.SwipeNavigationMode
import kotlinx.coroutines.launch

@Composable
fun SiteSettingsPage(nav: SettingsNav) {
    val model = nav.model
    val blocking = model.blockingState
    val lists = model.filterListsState
    SettingsPage(stringResource(R.string.settings_site_settings), onBack = nav::pop) {
        item(key = "blocking") {
            SettingsGroup {
                ToggleRow(
                    stringResource(R.string.site_block_ads), blocking.blocksAds, model::setBlocksAds,
                    icon = ArdiaSymbols.handRaisedFill, tint = SettingsTint.ads, showsDivider = true, tag = "blockAds",
                )
                ToggleRow(
                    stringResource(R.string.site_block_trackers), blocking.blocksTrackers, model::setBlocksTrackers,
                    icon = ArdiaSymbols.eyeglasses, tint = SettingsTint.trackers, showsDivider = true, tag = "blockTrackers",
                )
                ToggleRow(
                    stringResource(R.string.site_block_cookie_banners), blocking.hidesCookieBanners, model::setHidesCookieBanners,
                    icon = ArdiaSymbols.listBulletRectanglePortraitFill, tint = SettingsTint.cookies, showsDivider = true, tag = "blockCookies",
                )
                NavigationRow(
                    stringResource(R.string.site_filter_lists), ArdiaSymbols.line3HorizontalDecrease, SettingsTint.neutral,
                    onClick = { nav.push(SettingsRoute.FilterLists) },
                    value = FilterListWords.number(LocalContext.current.resources, lists.enabledLists.size),
                    showsDivider = true, tag = "filterLists",
                )
                NavigationRow(
                    stringResource(R.string.site_trusted_sites), ArdiaSymbols.checkmarkShieldFill, SettingsTint.green,
                    onClick = { nav.push(SettingsRoute.TrustedSites) },
                    value = if (blocking.exemptHosts.isEmpty()) stringResource(R.string.settings_none) else blocking.exemptHosts.size.toString(),
                    tag = "trustedSites",
                )
            }
        }
        item(key = "page") {
            SettingsGroup(footer = stringResource(R.string.site_footer)) {
                PickerRow(
                    stringResource(R.string.site_night_shade), NightShadeMode.entries, model.browsing.nightShade, { it.title }, model::setDefaultNightShade,
                    icon = ArdiaSymbols.moonFill, tint = SettingsTint.nightShade, showsDivider = true, tag = "nightShade",
                )
                PickerRow(
                    stringResource(R.string.site_swipe_to_navigate), SwipeNavigationMode.entries, model.browsing.swipeNavigation, { it.title },
                    model::setSwipeNavigation, icon = ArdiaSymbols.handDrawFill, tint = SettingsTint.swipe, showsDivider = true, tag = "swipe",
                )
                ToggleRow(
                    stringResource(R.string.site_collapse_bottom_bar), model.settings.collapsesBottomBar, { model.settings.collapsesBottomBar = it },
                    icon = ArdiaSymbols.platterFilledBottomAndArrowDownIphone, tint = SettingsTint.bottomBar, tag = "collapseBottomBar",
                )
            }
        }
    }
}

@Composable
fun SearchEnginePage(nav: SettingsNav) {
    val model = nav.model
    var engines by remember { mutableStateOf(SearchEngineNames.fallback) }
    LaunchedEffect(model) {
        val loaded = runCatching { model.searchEngines() }.getOrDefault(emptyList())
        engines = SearchEngineNames.choices(loaded)
    }
    val synced = if (model.syncState.isEnabled) model.syncSnapshot.search else null
    val selectedId = model.browsing.searchEngineId
    SettingsPage(stringResource(R.string.settings_search_engine), onBack = nav::pop) {
        if (synced != null) {
            item(key = "synced") {
                SettingsGroup(footer = stringResource(R.string.search_set_on_mac)) {
                    IconLabelRow(
                        stringResource(R.string.search_from_your_mac), ArdiaSymbols.macbook,
                        iconTint = Palette.formAccent.current,
                        value = SearchEngineNames.name(synced, stringResource(R.string.search_custom), engines),
                    )
                }
            }
        } else {
            item(key = "engines") {
                SettingsGroup {
                    engines.forEachIndexed { index, engine ->
                        EngineRow(engine, isSelected = engine.id == selectedId, showsDivider = index < engines.lastIndex) {
                            model.setSearchEngine(engine.id)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EngineRow(engine: EngineChoice, isSelected: Boolean, showsDivider: Boolean, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = SettingsLayout.rowMinHeight)
                .clickable(role = Role.RadioButton, onClick = onClick)
                .semantics { selected = isSelected }
                .testTag(SettingsTags.row("engine.${engine.id}"))
                .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(engine.name, style = ArdiaType.body, color = SystemPalette.label.current, modifier = Modifier.weight(1f))
            if (isSelected) Icon(ArdiaSymbols.checkmark, null, Modifier.size(18.dp), tint = Palette.formAccent.current)
        }
        if (showsDivider) RowDivider()
    }
}

@Composable
fun ClearBrowsingDataPage(nav: SettingsNav) {
    val model = nav.model
    val resources = LocalContext.current.resources
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var range by rememberSaveable { mutableStateOf(ClearRange.TODAY) }
    var history by rememberSaveable { mutableStateOf(true) }
    var cache by rememberSaveable { mutableStateOf(true) }
    var cookies by rememberSaveable { mutableStateOf(false) }
    var archive by rememberSaveable { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    val choice = ClearDataWords.choice(history, cache, cookies, archive, range)

    SettingsPage(stringResource(R.string.settings_clear_browsing_data), onBack = nav::pop) {
        item(key = "range") {
            SettingsGroup {
                PickerRow(stringResource(R.string.clear_time_range), ClearRange.entries, range, { it.title }, { range = it }, tag = "range")
            }
        }
        item(key = "kinds") {
            SettingsGroup(header = stringResource(R.string.clear_header), footer = ClearDataWords.footer(resources, choice)) {
                ToggleRow(stringResource(R.string.clear_history), history, { history = it }, showsDivider = true, tag = "clearHistory")
                ToggleRow(stringResource(R.string.clear_cache), cache, { cache = it }, showsDivider = true, tag = "clearCache")
                ToggleRow(stringResource(R.string.clear_cookies_and_site_data), cookies, { cookies = it }, showsDivider = range == ClearRange.ALL_TIME, tag = "clearCookies")
                if (range == ClearRange.ALL_TIME) ToggleRow(stringResource(R.string.clear_archived_tabs), archive, { archive = it }, tag = "clearArchive")
            }
        }
        item(key = "clear") {
            SettingsGroup {
                ButtonRow(
                    stringResource(R.string.clear_data_ellipsis),
                    onClick = { confirming = true },
                    enabled = !choice.isEmpty && !clearing,
                    destructive = true,
                    busy = clearing,
                    tag = "clearData",
                )
            }
        }
    }
    if (confirming) {
        ConfirmDialog(
            title = ClearDataWords.confirmationTitle(resources, choice, range),
            message = ClearDataWords.confirmationMessage(resources, choice),
            confirm = stringResource(R.string.clear_data),
            onConfirm = {
                haptics.performHapticFeedback(HapticFeedbackType.Reject)
                clearing = true
                scope.launch {
                    model.clearBrowsingData(choice, range)
                    clearing = false
                    nav.pop()
                }
            },
            onDismiss = { confirming = false },
        )
    }
}

@Composable
fun AboutPage(nav: SettingsNav) {
    val model = nav.model
    SettingsPage(stringResource(R.string.settings_about_ardia), onBack = nav::pop) {
        item(key = "hero") {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                AppIcon(side = 72.dp, shadow = true)
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
                    Text(stringResource(R.string.about_name), style = ArdiaType.title.bold, color = SystemPalette.label.current)
                    Text(rememberAppVersion(), style = ArdiaType.subheadline, color = SystemPalette.secondaryLabel.current)
                }
            }
        }
        item(key = "links") {
            SettingsGroup(footer = stringResource(R.string.about_footer)) {
                AboutLink(stringResource(R.string.about_site), ArdiaSymbols.globe, showsDivider = true) { model.openFromSettings("https://ardia.dev") }
                AboutLink(stringResource(R.string.about_release_notes), ArdiaSymbols.sparkles, showsDivider = true) { model.openFromSettings("https://ardia.dev/release-notes") }
                AboutLink(stringResource(R.string.about_source_code), ArdiaSymbols.chevronLeftForwardslashChevronRight) {
                    model.openFromSettings("https://github.com/mantrakp04/ardia")
                }
            }
        }
        item(key = "licenses") {
            SettingsGroup {
                NavigationRow(stringResource(R.string.about_licenses), ArdiaSymbols.docText, SystemPalette.secondaryLabel.current, onClick = { nav.push(SettingsRoute.Licenses) })
            }
        }
    }
}

@Composable
private fun AboutLink(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, showsDivider: Boolean = false, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = SettingsLayout.rowMinHeight)
                .clickable(role = Role.Button, onClickLabel = stringResource(R.string.about_opens_link), onClick = onClick)
                .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(SettingsLayout.labelGap),
        ) {
            Icon(icon, null, Modifier.size(22.dp), tint = Palette.formAccent.current)
            Text(title, style = ArdiaType.body, color = SystemPalette.label.current, modifier = Modifier.weight(1f))
            Icon(ArdiaSymbols.arrowUpForward, null, Modifier.size(13.dp), tint = SystemPalette.tertiaryLabel.current)
        }
        if (showsDivider) RowDivider(SettingsLayout.rowInset + 22.dp + SettingsLayout.labelGap)
    }
}

data class OpenSourceCredit(val name: String, val use: Int, val license: String, val url: String) {
    val displayUrl: String get() = url.removePrefix("https://")

    companion object {
        val all = listOf(
            OpenSourceCredit("Ardia", R.string.credit_ardia, "Apache License 2.0", "https://github.com/mantrakp04/ardia"),
            OpenSourceCredit("EasyList", R.string.credit_easylist, "CC BY-SA 3.0 or GPLv3", "https://easylist.to"),
            OpenSourceCredit("EasyPrivacy", R.string.credit_easyprivacy, "CC BY-SA 3.0 or GPLv3", "https://easylist.to"),
            OpenSourceCredit("Fanboy’s Cookie Monster List", R.string.credit_cookie_monster, "CC BY-SA 3.0 or GPLv3", "https://secure.fanboy.co.nz"),
            OpenSourceCredit("ZXing", R.string.credit_zxing, "Apache License 2.0", "https://github.com/zxing/zxing"),
            OpenSourceCredit("RE2/J", R.string.credit_re2j, "BSD 3-Clause License", "https://github.com/google/re2j"),
            OpenSourceCredit("OkHttp", R.string.credit_okhttp, "Apache License 2.0", "https://github.com/square/okhttp"),
            OpenSourceCredit("Hermes", R.string.credit_hermes, "MIT License", "https://github.com/facebook/hermes"),
            OpenSourceCredit("React Native JSI", R.string.credit_jsi, "MIT License", "https://github.com/facebook/react-native"),
            OpenSourceCredit("fbjni", R.string.credit_fbjni, "Apache License 2.0", "https://github.com/facebookincubator/fbjni"),
            OpenSourceCredit("Public Suffix List", R.string.credit_public_suffix, "Mozilla Public License 2.0", "https://publicsuffix.org"),
            OpenSourceCredit("Jetpack and AndroidX", R.string.credit_androidx, "Apache License 2.0", "https://developer.android.com/jetpack"),
            OpenSourceCredit("Kotlin", R.string.credit_kotlin, "Apache License 2.0", "https://kotlinlang.org"),
        )
    }
}

@Composable
fun LicensesPage(nav: SettingsNav) {
    val model = nav.model
    SettingsPage(stringResource(R.string.about_licenses), onBack = nav::pop) {
        for (credit in OpenSourceCredit.all) {
            item(key = credit.name) {
                SettingsGroup {
                    Column(Modifier.fillMaxWidth().padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.small), verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
                        Text(credit.name, style = ArdiaType.body.semibold, color = SystemPalette.label.current)
                        Text(stringResource(credit.use), style = ArdiaType.subheadline, color = SystemPalette.secondaryLabel.current)
                    }
                    RowDivider()
                    ValueRow(stringResource(R.string.about_license), credit.license, showsDivider = true)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = SettingsLayout.rowMinHeight)
                            .clickable(role = Role.Button) { model.openFromSettings(credit.url) }
                            .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(credit.displayUrl, style = ArdiaType.body, color = Palette.formAccent.current, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                        Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}
