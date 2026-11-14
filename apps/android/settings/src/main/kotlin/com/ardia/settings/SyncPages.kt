package com.ardia.settings

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ardia.appmodel.SettingsRoute
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.Motion
import com.ardia.design.Palette
import com.ardia.design.ProfileBackdrop
import com.ardia.design.SettingsGroup
import com.ardia.design.SettingsHero
import com.ardia.design.SettingsLayout
import com.ardia.design.SettingsTint
import com.ardia.design.SetupStepProgress
import com.ardia.design.SetupStepRow
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.medium
import com.ardia.design.monospacedDigits
import com.ardia.design.rememberSettingsHeroHidden
import com.ardia.sync.PhraseFooter
import com.ardia.sync.SyncJoin
import com.ardia.sync.SyncPhase
import com.ardia.sync.SyncStatusWords
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
private fun rememberIsSetupRoot(nav: SettingsNav): Boolean = remember { nav.closesAtRoot && nav.stack.isAtRoot }

@Composable
private fun SetupCloseButton(nav: SettingsNav) {
    BarTextButton(stringResource(R.string.settings_close), onClick = nav.close, modifier = Modifier.testTag(SettingsTags.row("closeSetup")))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncSettingsPage(nav: SettingsNav) {
    val model = nav.model
    val state = model.syncState
    val words = state.words
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val listState = rememberLazyListState()
    val heroHidden by rememberSettingsHeroHidden(listState)
    val isRoot = rememberIsSetupRoot(nav)
    var refreshing by remember { mutableStateOf(false) }
    var syncing by remember { mutableStateOf(false) }
    var confirmingStop by remember { mutableStateOf(false) }
    var stopping by remember { mutableStateOf(false) }
    var folderError by remember { mutableStateOf<String?>(null) }
    val pickFolder = rememberFolderPicker(stringResource(R.string.sync_default_folder)) { picked ->
        scope.launch { folderError = model.changeSyncFolder(picked.pick).message }
    }
    val syncNow: () -> Unit = {
        if (!syncing) {
            syncing = true
            scope.launch {
                model.syncNow()
                syncing = false
                val phase = model.syncState.phase
                when {
                    phase == SyncPhase.Updated -> haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    phase is SyncPhase.Stalled || phase == SyncPhase.Offline || phase == SyncPhase.NeedsFolderAccess || phase == SyncPhase.Locked || phase == SyncPhase.Reset ->
                        haptics.performHapticFeedback(HapticFeedbackType.Reject)
                    else -> Unit
                }
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        ProfileBackdrop(Modifier.fillMaxSize())
        Column(Modifier.fillMaxSize()) {
            SettingsTopBar(
                stringResource(R.string.sync_with_mac),
                showsTitle = heroHidden,
                onBack = if (isRoot) null else nav::pop,
                leading = if (isRoot) ({ SetupCloseButton(nav) }) else null,
            )
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    if (!state.isEnabled) return@PullToRefreshBox
                    refreshing = true
                    scope.launch {
                        model.syncNow()
                        refreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                androidx.compose.foundation.lazy.LazyColumn(
                    Modifier.fillMaxSize(),
                    state = listState,
                    contentPadding = settingsContentPadding(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.large),
                ) {
                    item(key = "hero") {
                        SettingsHero(
                            title = stringResource(R.string.sync_with_mac),
                            subtitle = words.heroSubtitle.text,
                            icon = ArdiaSymbols.macbookAndIphone,
                            tint = SettingsTint.sync,
                        ) {
                            Box(Modifier.fillMaxWidth().animateContentSize(Motion.smooth.spec())) {
                                if (words.isOff) {
                                    CapsuleButton(
                                        stringResource(R.string.sync_connect),
                                        onClick = { nav.push(SettingsRoute.Connect) },
                                        prominent = true,
                                        large = true,
                                        modifier = Modifier.fillMaxWidth().padding(top = Spacing.tight).testTag(SettingsTags.row("connect")),
                                    )
                                }
                            }
                        }
                    }
                    if (words.isOff) {
                        offSections()
                    } else {
                        attentionSection(words.attention, nav, onChooseFolder = pickFolder)
                        if (words.isConnected) {
                            connectedSections(
                                nav = nav,
                                syncing = syncing,
                                onSyncNow = syncNow,
                                onChooseFolder = pickFolder,
                                folderError = folderError,
                                stopping = stopping,
                                onStop = { confirmingStop = true },
                            )
                        }
                    }
                }
            }
        }
    }
    if (confirmingStop) {
        ConfirmDialog(
            title = stringResource(R.string.sync_stop_title),
            message = stringResource(R.string.sync_stop_message),
            confirm = stringResource(R.string.sync_stop),
            onConfirm = {
                haptics.performHapticFeedback(HapticFeedbackType.Reject)
                stopping = true
                scope.launch {
                    model.stopSyncing()
                    stopping = false
                }
            },
            onDismiss = { confirmingStop = false },
        )
    }
}

private fun LazyListScope.offSections() {
    item(key = "features") {
        SettingsGroup(header = stringResource(R.string.sync_what_you_get), footer = stringResource(R.string.sync_off_footer)) {
            SyncFeatureRow(ArdiaSymbols.macbook, stringResource(R.string.sync_feature_mac_tabs), showsDivider = true)
            SyncFeatureRow(ArdiaSymbols.pinFill, stringResource(R.string.sync_feature_pinned), showsDivider = true)
            SyncFeatureRow(ArdiaSymbols.paperplaneFill, stringResource(R.string.sync_feature_send), showsDivider = true)
            SyncFeatureRow(ArdiaSymbols.clockArrowCirclepath, stringResource(R.string.sync_feature_history))
        }
    }
}

@Composable
private fun SyncFeatureRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, showsDivider: Boolean = false) {
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, Modifier.width(28.dp).size(20.dp), tint = Palette.formAccent.current)
            Text(title, style = ArdiaType.body, color = SystemPalette.label.current)
        }
        if (showsDivider) RowDivider(SettingsLayout.rowInset + 28.dp + Spacing.small)
    }
}

private fun LazyListScope.attentionSection(attention: SyncStatusWords.Attention, nav: SettingsNav, onChooseFolder: () -> Unit) {
    when (attention) {
        SyncStatusWords.Attention.FOLDER -> item(key = "attention.folder") {
            SettingsGroup(footer = stringResource(R.string.sync_choose_again_footer)) {
                ButtonRow(stringResource(R.string.sync_choose_folder), onClick = onChooseFolder, tag = "chooseFolderAgain")
            }
        }
        SyncStatusWords.Attention.PHRASE -> item(key = "attention.phrase") {
            SettingsGroup {
                NavigationRow(stringResource(R.string.sync_enter_phrase), null, Palette.formAccent.current, onClick = { nav.push(SettingsRoute.Connect) }, tag = "enterPhrase")
            }
        }
        SyncStatusWords.Attention.RESET -> item(key = "attention.reset") {
            val scope = rememberCoroutineScope()
            SettingsGroup(footer = stringResource(R.string.sync_reset_footer)) {
                NavigationRow(
                    stringResource(R.string.sync_connect_again), null, Palette.formAccent.current,
                    onClick = {
                        scope.launch {
                            nav.model.acknowledgeSyncReset()
                            nav.push(SettingsRoute.Connect)
                        }
                    },
                    tag = "connectAgain",
                )
            }
        }
        SyncStatusWords.Attention.NONE, SyncStatusWords.Attention.STALLED -> Unit
    }
}

private fun LazyListScope.connectedSections(
    nav: SettingsNav,
    syncing: Boolean,
    onSyncNow: () -> Unit,
    onChooseFolder: () -> Unit,
    folderError: String?,
    stopping: Boolean,
    onStop: () -> Unit,
) {
    item(key = "syncNow") {
        SettingsGroup {
            ButtonRow(stringResource(if (syncing) R.string.sync_syncing else R.string.sync_now), onClick = onSyncNow, enabled = !syncing, busy = syncing, tag = "syncNow")
        }
    }
    item(key = "devices") {
        val model = nav.model
        val devices = remember(model.syncSnapshot.devices) { SyncDeviceWords.ordered(model.syncSnapshot.devices) }
        if (devices.isNotEmpty()) {
            val resources = LocalContext.current.resources
            val now = remember(model.syncSnapshot) { System.currentTimeMillis() }
            val noReceivers = model.syncSnapshot.devicesThatReceiveTabs(model.selectedProfile?.syncId ?: model.syncState.selectedProfileId).isEmpty()
            SettingsGroup(header = stringResource(R.string.sync_devices), footer = if (noReceivers) stringResource(R.string.sync_update_mac_footer) else null) {
                devices.forEachIndexed { index, device ->
                    SettingsRowWithDivider(showsDivider = index < devices.lastIndex) {
                        IconLabelRow(device.name, SyncDeviceWords.icon(device), value = SyncDeviceWords.lastSeen(resources, device, now))
                    }
                }
            }
        }
    }
    item(key = "name") { DeviceNameSection(nav) }
    item(key = "folder") {
        val model = nav.model
        SettingsGroup(
            header = stringResource(R.string.sync_folder_header),
            footer = folderError ?: stringResource(R.string.sync_folder_footer),
        ) {
            ValueRow(stringResource(R.string.sync_folder), model.syncState.folderName ?: stringResource(R.string.sync_default_folder), showsDivider = true)
            ButtonRow(stringResource(R.string.sync_change_folder), onClick = onChooseFolder, tag = "changeFolder")
        }
    }
    item(key = "stop") {
        SettingsGroup(footer = stringResource(R.string.sync_stop_footer)) {
            ButtonRow(stringResource(R.string.sync_stop_ellipsis), onClick = onStop, enabled = !stopping, destructive = true, busy = stopping, tag = "stopSyncing")
        }
    }
}

@Composable
private fun SettingsRowWithDivider(showsDivider: Boolean, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        content()
        if (showsDivider) RowDivider(SettingsLayout.rowInset + 22.dp + SettingsLayout.labelGap)
    }
}

@Composable
private fun DeviceNameSection(nav: SettingsNav) {
    val model = nav.model
    val focus = LocalFocusManager.current
    val current = model.syncState.deviceName
    var draft by rememberSaveable(current) { mutableStateOf(current) }
    LaunchedEffect(draft) {
        delay(NAME_SETTLE_MILLIS)
        val trimmed = draft.trim()
        if (trimmed.isNotEmpty() && trimmed != model.syncState.deviceName) model.setDeviceName(trimmed)
    }
    SettingsGroup(header = stringResource(R.string.sync_device_name_header), footer = stringResource(R.string.sync_device_name_footer)) {
        Box(Modifier.fillMaxWidth().heightIn(min = SettingsLayout.rowMinHeight).padding(horizontal = SettingsLayout.rowInset), contentAlignment = Alignment.CenterStart) {
            SettingsTextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = stringResource(R.string.sync_name),
                modifier = Modifier.fillMaxWidth().testTag(SettingsTags.row("deviceName")),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
            )
        }
    }
}

private const val NAME_SETTLE_MILLIS = 600L

@Composable
fun SyncConnectPage(nav: SettingsNav, onConnected: () -> Unit) {
    val model = nav.model
    val session = nav.connect
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val listState = rememberLazyListState()
    val heroHidden by rememberSettingsHeroHidden(listState)
    val isRoot = rememberIsSetupRoot(nav)
    var scanning by rememberSaveable { mutableStateOf(false) }
    val hasPhrase = session.hasPhrase
    val folder = session.folder
    val connect: () -> Unit = {
        scope.launch {
            val result = session.connectIfReady() ?: return@launch
            if (result.message != null) {
                haptics.performHapticFeedback(HapticFeedbackType.Reject)
            } else {
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                onConnected()
            }
        }
    }
    val pickFolder = rememberFolderPicker(stringResource(R.string.sync_default_folder)) { picked ->
        session.pickFolder(picked)
        connect()
    }
    LaunchedEffect(hasPhrase) { if (hasPhrase && session.isReady) connect() }
    BackHandler(enabled = session.isConnecting) {}

    SettingsPage(
        stringResource(R.string.sync_connect),
        onBack = if (isRoot || session.isConnecting) null else nav::pop,
        leading = if (isRoot) ({ SetupCloseButton(nav) }) else null,
        state = listState,
        showsTitle = heroHidden,
    ) {
        item(key = "hero") {
            SettingsHero(stringResource(R.string.sync_connect), stringResource(R.string.connect_subtitle), ArdiaSymbols.macbookAndIphone, SettingsTint.sync)
        }
        item(key = "steps") {
            SettingsGroup(header = stringResource(R.string.connect_two_steps), footer = stringResource(R.string.connect_footer)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.small), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    SetupStepRow(
                        number = 1,
                        title = stringResource(R.string.connect_step_code),
                        detail = SyncJoin.MAC_HINT,
                        progress = SetupStepProgress.step(done = hasPhrase, after = true),
                    ) {
                        AnimatedContent(hasPhrase, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "phraseStep") { added ->
                            if (added) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.tight)) {
                                    Icon(ArdiaSymbols.checkmarkCircleFill, null, Modifier.size(18.dp), tint = goodInk())
                                    Text(stringResource(R.string.connect_phrase_added), style = ArdiaType.subheadline.medium, color = goodInk(), modifier = Modifier.weight(1f))
                                    BarTextButton(stringResource(R.string.connect_change), onClick = { nav.push(SettingsDestination.EnterWords) })
                                }
                            } else {
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.tight), verticalArrangement = Arrangement.spacedBy(Spacing.tight)) {
                                    CapsuleButton(
                                        stringResource(R.string.connect_scan_code), onClick = { scanning = true }, icon = ArdiaSymbols.qrcodeViewfinder, prominent = true,
                                        modifier = Modifier.testTag(SettingsTags.row("scanCode")),
                                    )
                                    CapsuleButton(
                                        stringResource(R.string.connect_enter_words), onClick = { nav.push(SettingsDestination.EnterWords) }, icon = ArdiaSymbols.characterCursorIbeam,
                                        modifier = Modifier.testTag(SettingsTags.row("enterWords")),
                                    )
                                }
                            }
                        }
                    }
                    SetupStepRow(
                        number = 2,
                        title = stringResource(R.string.connect_step_folder),
                        detail = stringResource(R.string.connect_step_folder_detail),
                        progress = SetupStepProgress.step(done = false, after = hasPhrase),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.tight)) {
                            if (folder != null && !session.isConnecting) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Icon(ArdiaSymbols.folderFill, null, Modifier.size(16.dp), tint = SystemPalette.secondaryLabel.current)
                                    Text(folder.name, style = ArdiaType.subheadline.medium, color = SystemPalette.secondaryLabel.current)
                                }
                            }
                            if (session.isConnecting) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.tight)) {
                                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = SystemPalette.secondaryLabel.current)
                                    Text(stringResource(R.string.connect_connecting), style = ArdiaType.subheadline, color = SystemPalette.secondaryLabel.current)
                                }
                            } else {
                                CapsuleButton(
                                    stringResource(if (folder == null) R.string.sync_choose_folder else R.string.connect_choose_another),
                                    onClick = pickFolder,
                                    modifier = Modifier.testTag(SettingsTags.row("chooseFolder")),
                                )
                            }
                            AnimatedVisibility(session.failure != null) {
                                Text(session.failure.orEmpty(), style = ArdiaType.subheadline, color = problemInk())
                            }
                        }
                    }
                }
            }
        }
    }
    if (scanning) {
        Dialog(
            onDismissRequest = { scanning = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            SyncCodeScanner(
                onScan = { code ->
                    session.usePhrase(code)
                    if (session.folder == null) haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    scanning = false
                },
                onEnterWords = {
                    scanning = false
                    nav.push(SettingsDestination.EnterWords)
                },
                onCancel = { scanning = false },
            )
        }
    }
}

@Composable
fun RecoveryPhraseEntryPage(nav: SettingsNav) {
    val model = nav.model
    val session = nav.connect
    val haptics = LocalHapticFeedback.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable { mutableStateOf(session.phrase) }
    val focus = remember { FocusRequester() }
    val check = model.checkPhrase(draft)
    val footer = SyncJoin.footer(check)
    LaunchedEffect(check.isValid) { if (check.isValid) haptics.performHapticFeedback(HapticFeedbackType.Confirm) }
    LaunchedEffect(Unit) { if (draft.isEmpty()) runCatching { focus.requestFocus() } }
    val use: () -> Unit = {
        if (check.isValid) {
            session.usePhrase(draft)
            nav.pop()
        }
    }
    SettingsPage(
        stringResource(R.string.phrase_title),
        onBack = nav::pop,
        trailing = {
            BarTextButton(stringResource(R.string.phrase_use), onClick = use, enabled = check.isValid, emphasized = true, modifier = Modifier.testTag(SettingsTags.row("usePhrase")))
        },
    ) {
        item(key = "phrase") {
            Column {
                Row(Modifier.fillMaxWidth().padding(start = Spacing.page + SettingsLayout.rowInset, end = Spacing.page + SettingsLayout.rowInset, bottom = Spacing.tight)) {
                    Text(stringResource(R.string.phrase_header), style = ArdiaType.footnote, color = SystemPalette.secondaryLabel.current)
                    Spacer(Modifier.weight(1f))
                    AnimatedContent(check.counterText, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "wordCount") { counter ->
                        Text(
                            counter,
                            style = ArdiaType.footnote.monospacedDigits,
                            color = if (check.isTooLong) problemInk() else SystemPalette.secondaryLabel.current,
                            modifier = Modifier.testTag(SettingsTags.row("wordCount")),
                        )
                    }
                }
                FieldSurface {
                    SettingsTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = stringResource(R.string.phrase_placeholder),
                        singleLine = false,
                        minLines = 5,
                        maxLines = 10,
                        monospaced = true,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None,
                            autoCorrectEnabled = false,
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = { use() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag(SettingsTags.row("phraseField")),
                    )
                }
                Crossfade(footer, label = "phraseFooter") { line ->
                    val color = when (line.tone) {
                        PhraseFooter.Tone.PROBLEM -> problemInk()
                        PhraseFooter.Tone.GOOD -> goodInk()
                        PhraseFooter.Tone.HINT -> SystemPalette.secondaryLabel.current
                    }
                    FootnoteText(line.text, Modifier.padding(top = Spacing.tight).testTag(SettingsTags.row("phraseFooter")), color = color)
                }
            }
        }
        if (draft.isEmpty()) {
            item(key = "paste") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CapsuleButton(stringResource(R.string.settings_paste), icon = ArdiaSymbols.docOnDoc, onClick = {
                        scope.launch {
                            val text = clipboard.getClipEntry()?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
                            if (!text.isNullOrBlank()) draft = text
                        }
                    })
                }
            }
        }
    }
}

@Composable
fun SyncSetupView(model: com.ardia.appmodel.AppModel, modifier: Modifier = Modifier) {
    SyncSetupContent(model, modifier, onClose = { model.sheet = null })
}

@Composable
fun SyncSetupContent(model: com.ardia.appmodel.AppModel, modifier: Modifier = Modifier, onClose: () -> Unit) {
    val stack = remember { SettingsBackStack() }
    val connect = remember(model) { SyncConnectSession(model) }
    val nav = remember(model, stack, connect, onClose) { SettingsNav(model, stack, connect, close = onClose, closesAtRoot = true) }
    SettingsNavHost(nav, modifier) {
        if (model.syncState.words.isConnected) SyncSettingsPage(nav) else SyncConnectPage(nav, onConnected = onClose)
    }
}
