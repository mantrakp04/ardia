package com.ardia.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.SettingsRoute
import com.ardia.blocking.FilterListAddress
import com.ardia.blocking.FilterListGroup
import com.ardia.blocking.FilterListInfo
import com.ardia.blocking.FilterListState
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.Palette
import com.ardia.design.ProfileBackdrop
import com.ardia.design.SettingsGroup
import com.ardia.design.SettingsHero
import com.ardia.design.SettingsLayout
import com.ardia.design.SettingsSwitch
import com.ardia.design.SettingsTint
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.rememberSettingsHeroHidden
import com.ardia.design.semibold
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilterListsPage(nav: SettingsNav) {
    val model = nav.model
    val source = model.filterListsState
    val resources = LocalContext.current.resources
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val heroHidden by rememberSettingsHeroHidden(listState)
    var adding by rememberSaveable { mutableStateOf(false) }
    var confirmingReset by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val now = remember(source) { System.currentTimeMillis() }
    val update = {
        scope.launch {
            model.updateFilterListsNow()
            val state = model.filterListsState
            val failed = state.isOffline || state.enabledLists.any { it.state is FilterListState.Failed }
            haptics.performHapticFeedback(if (failed) HapticFeedbackType.Reject else HapticFeedbackType.Confirm)
        }
    }
    val groups = remember(source.lists) { FilterListGroup.entries.map { group -> group to source.lists.filter { it.group == group } }.filter { it.second.isNotEmpty() } }

    Box(Modifier.fillMaxSize()) {
        ProfileBackdrop(Modifier.fillMaxSize())
        Column(Modifier.fillMaxSize()) {
            SettingsTopBar(stringResource(R.string.site_filter_lists), showsTitle = heroHidden, onBack = nav::pop)
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    refreshing = true
                    scope.launch {
                        model.updateFilterListsNow()
                        refreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = settingsContentPadding()) {
                    item(key = "hero") {
                        SettingsHero(
                            title = stringResource(R.string.site_filter_lists),
                            subtitle = FilterListWords.summary(resources, source.enabledLists.size, source.enabledRuleCount),
                            icon = ArdiaSymbols.shieldLefthalfFilled,
                            tint = SettingsTint.ads,
                        ) {
                            Crossfade(FilterListWords.status(resources, source.isUpdating, source.isOffline, source.lastUpdated, now), label = "listsStatus") { status ->
                                Text(status, style = ArdiaType.footnote, color = if (source.isOffline) warningInk() else SystemPalette.secondaryLabel.current)
                            }
                        }
                    }
                    item(key = "update") {
                        SettingsGroup(Modifier.padding(top = Spacing.large), footer = stringResource(R.string.lists_checked_weekly)) {
                            ButtonRow(
                                stringResource(if (source.isUpdating) R.string.lists_updating_lists else R.string.lists_update_now),
                                onClick = { update() },
                                enabled = !source.isUpdating,
                                busy = source.isUpdating,
                                tag = "updateLists",
                            )
                        }
                    }
                    for ((group, lists) in groups) {
                        item(key = "header:${group.name}") { GroupHeader(group.title, Modifier.padding(top = Spacing.large)) }
                        lists.forEachIndexed { index, list ->
                            item(key = "list:${list.id}") {
                                FilterListRow(
                                    list = list,
                                    now = now,
                                    isFirst = index == 0,
                                    isLast = index == lists.lastIndex,
                                    onToggle = { model.setFilterListEnabled(list.id, it) },
                                    onShowDetail = { nav.push(SettingsDestination.FilterList(list.id)) },
                                )
                            }
                        }
                    }
                    item(key = "mine") {
                        SettingsGroup(Modifier.padding(top = Spacing.large)) {
                            ButtonRow(stringResource(R.string.lists_add_ellipsis), onClick = { adding = true }, showsDivider = true, tag = "addList")
                            NavigationRow(
                                stringResource(R.string.lists_my_filters), null, Palette.formAccent.current,
                                onClick = { nav.push(SettingsRoute.MyFilters) },
                                value = FilterListWords.myFiltersCount(resources, source.myFiltersResult),
                                tag = "myFilters",
                            )
                        }
                    }
                    item(key = "reset") {
                        SettingsGroup(Modifier.padding(top = Spacing.large)) {
                            ButtonRow(stringResource(R.string.lists_restore_ellipsis), onClick = { confirmingReset = true }, destructive = true, tag = "restoreLists")
                        }
                    }
                }
            }
        }
    }
    if (adding) AddFilterListSheet(nav, onDismiss = { adding = false })
    if (confirmingReset) {
        ConfirmDialog(
            title = stringResource(R.string.lists_restore_title),
            message = FilterListWords.resetMessage(resources, source.customListCount),
            confirm = stringResource(R.string.lists_restore),
            onConfirm = { scope.launch { model.resetFilterLists() } },
            onDismiss = { confirmingReset = false },
        )
    }
}

@Composable
private fun FilterListRow(list: FilterListInfo, now: Long, isFirst: Boolean, isLast: Boolean, onToggle: (Boolean) -> Unit, onShowDetail: () -> Unit) {
    val resources = LocalContext.current.resources
    val facts = FilterListWords.facts(resources, list, now)
    val detailsHint = stringResource(R.string.lists_shows_details)
    Column(
        Modifier
            .fillMaxWidth()
            .groupedItem(isFirst, isLast)
            .background(SystemPalette.secondaryGroupedBackground.current)
            .testTag(SettingsTags.row("list.${list.id}")),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = SettingsLayout.rowMinHeight).padding(end = SettingsLayout.rowInset),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        ) {
            Column(
                Modifier
                    .weight(1f)
                    .clickable(role = Role.Button, onClickLabel = detailsHint, onClick = onShowDetail)
                    .padding(start = SettingsLayout.rowInset, top = Spacing.tight, bottom = Spacing.tight),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(list.title, style = ArdiaType.body, color = SystemPalette.label.current)
                Crossfade(facts, label = "listFacts") { line ->
                    Text(line.text, style = ArdiaType.subheadline, color = if (line.isWarning) warningInk() else SystemPalette.secondaryLabel.current)
                }
            }
            if (FilterListWords.isBusy(list)) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = SystemPalette.secondaryLabel.current)
            SettingsSwitch(
                checked = list.isEnabled,
                onCheckedChange = onToggle,
                modifier = Modifier.testTag(SettingsTags.toggle("list.${list.id}")).semantics { contentDescription = list.title },
            )
        }
        if (!isLast) RowDivider()
    }
}

@Composable
fun FilterListDetailPage(nav: SettingsNav, listId: String) {
    val model = nav.model
    val resources = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    val source = model.filterListsState
    val list = source.list(listId)
    var confirmingRemoval by remember { mutableStateOf(false) }
    SettingsPage(list?.title ?: stringResource(R.string.list_fallback_title), onBack = nav::pop) {
        if (list == null) {
            item(key = "removed") { EmptyState(stringResource(R.string.list_removed), "", ArdiaSymbols.listBulletRectangle) }
            return@SettingsPage
        }
        item(key = "use") {
            SettingsGroup(footer = if (list.isDefault) stringResource(R.string.list_on_by_default) else null) {
                ToggleRow(stringResource(R.string.list_use), list.isEnabled, { model.setFilterListEnabled(list.id, it) }, tag = "useList")
            }
        }
        val failure = list.state as? FilterListState.Failed
        if (failure != null) {
            item(key = "failure") {
                SettingsGroup {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.small),
                        horizontalArrangement = Arrangement.spacedBy(SettingsLayout.labelGap),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(ArdiaSymbols.exclamationmarkTriangleFill, null, Modifier.size(22.dp), tint = warningInk())
                        Text(failure.message, style = ArdiaType.body, color = SystemPalette.label.current)
                    }
                    RowDivider()
                    ButtonRow(stringResource(R.string.list_try_again), onClick = { scope.launch { model.updateFilterListsNow() } }, enabled = !source.isUpdating)
                }
            }
        }
        item(key = "facts") {
            val updated = list.updatedAt?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)) }
            SettingsGroup(footer = if (list.skippedCount > 0) stringResource(R.string.list_skipped_footer) else null) {
                ValueRow(stringResource(R.string.list_status), FilterListWords.detailStatus(resources, list), showsDivider = true)
                ValueRow(stringResource(R.string.list_last_updated), updated ?: stringResource(R.string.list_never), showsDivider = true)
                ValueRow(stringResource(R.string.list_rules), FilterListWords.number(resources, list.ruleCount), showsDivider = true)
                ValueRow(stringResource(R.string.list_skipped), FilterListWords.number(resources, list.skippedCount))
            }
        }
        val sourceUrl = list.sourceUrl
        if (sourceUrl != null) {
            item(key = "source") {
                SettingsGroup(header = stringResource(R.string.list_source)) {
                    LinkRow(sourceUrl, showsDivider = list.supportUrl != null, small = true) { model.openFromSettings(sourceUrl) }
                    list.supportUrl?.let { support -> LinkRow(stringResource(R.string.list_visit_website)) { model.openFromSettings(support) } }
                }
            }
        }
        if (list.isCustom) {
            item(key = "remove") {
                SettingsGroup {
                    ButtonRow(stringResource(R.string.list_remove_ellipsis), onClick = { confirmingRemoval = true }, destructive = true, tag = "removeList")
                }
            }
        }
    }
    if (confirmingRemoval) {
        ConfirmDialog(
            title = stringResource(R.string.list_remove_title),
            message = stringResource(R.string.list_remove_message),
            confirm = stringResource(R.string.list_remove),
            onConfirm = {
                model.removeFilterList(listId)
                nav.pop()
            },
            onDismiss = { confirmingRemoval = false },
        )
    }
}

@Composable
fun LinkRow(text: String, showsDivider: Boolean = false, small: Boolean = false, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            text,
            style = if (small) ArdiaType.subheadline else ArdiaType.body,
            color = Palette.formAccent.current,
            maxLines = 2,
            overflow = TextOverflow.MiddleEllipsis,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = SettingsLayout.rowMinHeight)
                .clickable(role = Role.Button, onClickLabel = stringResource(R.string.about_opens_link), onClick = onClick)
                .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.small),
        )
        if (showsDivider) RowDivider()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddFilterListSheet(nav: SettingsNav, onDismiss: () -> Unit) {
    val model = nav.model
    val haptics = LocalHapticFeedback.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false, confirmValueChange = { true })
    var address by rememberSaveable { mutableStateOf("") }
    var failure by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val validation = FilterListAddress.validate(address)
    val close: () -> Unit = {
        scope.launch {
            sheetState.hide()
            onDismiss()
        }
    }
    val add: () -> Unit = add@{
        val url = FilterListAddress.validate(address).url ?: return@add
        if (adding) return@add
        adding = true
        scope.launch {
            val message = model.addFilterList(url)
            adding = false
            if (message != null) {
                failure = message
                haptics.performHapticFeedback(HapticFeedbackType.Reject)
            } else {
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                close()
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    ModalBottomSheet(
        onDismissRequest = { if (!adding) onDismiss() },
        sheetState = sheetState,
        containerColor = SystemPalette.groupedBackground.current,
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.ime)) {
            SettingsTopBar(
                stringResource(R.string.add_list_title),
                leading = { BarTextButton(stringResource(R.string.settings_cancel), onClick = close) },
                trailing = {
                    if (adding) {
                        CircularProgressIndicator(Modifier.padding(end = Spacing.small).size(20.dp), strokeWidth = 2.dp)
                    } else {
                        BarTextButton(stringResource(R.string.add_list_add), onClick = add, enabled = validation.url != null, emphasized = true, modifier = Modifier.testTag(SettingsTags.row("addListConfirm")))
                    }
                },
            )
            val footer = when {
                failure != null -> failure!! to problemInk()
                validation is FilterListAddress.Validation.Invalid && address.isNotEmpty() -> validation.message to SystemPalette.secondaryLabel.current
                else -> stringResource(R.string.add_list_footer) to SystemPalette.secondaryLabel.current
            }
            Column(Modifier.padding(vertical = Spacing.large), verticalArrangement = Arrangement.spacedBy(Spacing.large)) {
                Column {
                    GroupHeader(stringResource(R.string.add_list_address))
                    FieldSurface {
                        SettingsTextField(
                            value = address,
                            onValueChange = {
                                address = it
                                failure = null
                            },
                            placeholder = stringResource(R.string.add_list_placeholder),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag(SettingsTags.row("addListField")),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { add() }),
                        )
                    }
                    Crossfade(footer, label = "addFooter") { (text, color) -> FootnoteText(text, Modifier.padding(top = Spacing.tight), color = color) }
                }
                AnimatedVisibility(address.isEmpty(), modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    CapsuleButton(stringResource(R.string.settings_paste), icon = ArdiaSymbols.docOnDoc, onClick = {
                        scope.launch {
                            val text = clipboard.getClipEntry()?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()?.trim()
                            if (!text.isNullOrEmpty()) address = text
                        }
                    })
                }
            }
        }
    }
}

@Composable
fun MyFiltersEditor(nav: SettingsNav) {
    val model = nav.model
    val resources = LocalContext.current.resources
    val haptics = LocalHapticFeedback.current
    val keyboard = LocalSoftwareKeyboardController.current
    val scope = rememberCoroutineScope()
    val source = model.filterListsState
    var draft by rememberSaveable { mutableStateOf<String?>(null) }
    var applying by remember { mutableStateOf(false) }
    val text = draft ?: source.myFilters
    val hasChanges = draft != null && draft != source.myFilters
    androidx.activity.compose.BackHandler(enabled = hasChanges) {}
    val apply: () -> Unit = {
        applying = true
        scope.launch {
            model.applyMyFilters(text)
            applying = false
            keyboard?.hide()
            draft = null
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
        }
    }
    Column(Modifier.fillMaxSize().background(SystemPalette.background.current)) {
        SettingsTopBar(
            stringResource(R.string.lists_my_filters),
            onBack = if (hasChanges) null else nav::pop,
            leading = if (hasChanges) ({ BarTextButton(stringResource(R.string.my_filters_revert), onClick = { draft = null }) }) else null,
            trailing = {
                if (applying) {
                    CircularProgressIndicator(Modifier.padding(end = Spacing.small).size(20.dp), strokeWidth = 2.dp)
                } else {
                    BarTextButton(stringResource(R.string.my_filters_apply), onClick = apply, enabled = hasChanges, emphasized = true, modifier = Modifier.testTag(SettingsTags.row("applyFilters")))
                }
            },
        )
        SettingsTextField(
            value = text,
            onValueChange = { draft = it },
            placeholder = stringResource(R.string.my_filters_placeholder),
            singleLine = false,
            monospaced = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.page, vertical = Spacing.tight)
                .testTag(SettingsTags.row("myFiltersField")),
        )
        MyFiltersFooter(
            summary = FilterListWords.myFiltersSummary(resources, source.myFiltersResult, hasChanges),
            hasChanges = hasChanges,
            onSyntax = { model.openFromSettings(FILTER_SYNTAX_URL) },
        )
    }
}

private const val FILTER_SYNTAX_URL = "https://github.com/gorhill/uBlock/wiki/Static-filter-syntax"

@Composable
private fun MyFiltersFooter(summary: String, hasChanges: Boolean, onSyntax: () -> Unit) {
    val large = LocalDensity.current.fontScale >= ACCESSIBILITY_FONT_SCALE
    Column(
        Modifier
            .fillMaxWidth()
            .background(com.ardia.design.SettingsChrome.topBarColor)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal).union(WindowInsets.ime))
            .padding(horizontal = Spacing.page, vertical = Spacing.small),
        verticalArrangement = Arrangement.spacedBy(Spacing.hairline),
    ) {
        Crossfade(summary, label = "filtersSummary") { line ->
            Text(line, style = ArdiaType.footnote.semibold, color = if (hasChanges) warningInk() else SystemPalette.secondaryLabel.current)
        }
        if (!large) {
            val help = stringResource(R.string.my_filters_help, "||site.com^", "site.com##.ad")
            Text(help, style = ArdiaType.footnote, color = SystemPalette.secondaryLabel.current)
        }
        Text(
            stringResource(R.string.my_filters_syntax),
            style = ArdiaType.footnote.semibold,
            color = Palette.formAccent.current,
            modifier = Modifier.clickable(role = Role.Button, onClick = onSyntax).padding(vertical = Spacing.hairline),
        )
    }
}

@Composable
fun TrustedSitesPage(nav: SettingsNav) {
    val model = nav.model
    val hosts = remember(model.blockingState.exemptHosts) { model.blockingState.exemptHosts.sorted() }
    var editing by rememberSaveable { mutableStateOf(false) }
    if (hosts.isEmpty() && editing) editing = false
    SettingsPage(
        stringResource(R.string.site_trusted_sites),
        onBack = nav::pop,
        itemSpacing = 0.dp,
        trailing = if (hosts.isEmpty()) null else ({
            BarTextButton(stringResource(if (editing) R.string.settings_done else R.string.trusted_edit), onClick = { editing = !editing }, emphasized = editing)
        }),
    ) {
        if (hosts.isEmpty()) {
            item(key = "empty") { EmptyState(stringResource(R.string.trusted_empty_title), stringResource(R.string.trusted_empty_message), ArdiaSymbols.checkmarkShield) }
            return@SettingsPage
        }
        hosts.forEachIndexed { index, host ->
            item(key = host) {
                TrustedSiteRow(host, editing, isFirst = index == 0, isLast = index == hosts.lastIndex, Modifier.animateItem()) { model.setExempt(host, false) }
            }
        }
    }
}

@Composable
private fun TrustedSiteRow(host: String, editing: Boolean, isFirst: Boolean, isLast: Boolean, modifier: Modifier = Modifier, onRemove: () -> Unit) {
    val removeLabel = stringResource(R.string.trusted_remove, host)
    Column(
        modifier
            .fillMaxWidth()
            .groupedItem(isFirst, isLast)
            .background(SystemPalette.secondaryGroupedBackground.current)
            .semantics(mergeDescendants = true) { customActions = listOf(CustomAccessibilityAction(removeLabel) { onRemove(); true }) },
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = SettingsLayout.rowMinHeight).padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(SettingsLayout.labelGap),
        ) {
            AnimatedVisibility(editing) {
                Box(
                    Modifier
                        .size(24.dp)
                        .background(SystemPalette.red.current, androidx.compose.foundation.shape.CircleShape)
                        .clickable(role = Role.Button, onClickLabel = removeLabel, onClick = onRemove)
                        .testTag(SettingsTags.row("remove.$host")),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(ArdiaSymbols.minus, removeLabel, Modifier.size(14.dp), tint = androidx.compose.ui.graphics.Color.White)
                }
            }
            Icon(ArdiaSymbols.globe, null, Modifier.size(22.dp), tint = SystemPalette.secondaryLabel.current)
            Text(host, style = ArdiaType.body, color = SystemPalette.label.current, modifier = Modifier.weight(1f))
        }
        if (!isLast) RowDivider(SettingsLayout.rowInset + 22.dp + SettingsLayout.labelGap)
    }
}
