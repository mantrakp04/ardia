package com.ardia.tabs

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.FaviconImage
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LocalIncreasedContrast
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.design.Palette
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.TabsLayout
import com.ardia.design.medium
import com.ardia.design.semibold
import com.ardia.store.BrowserUrl
import com.ardia.sync.BookmarkItem
import com.ardia.sync.DeviceTabs
import com.ardia.sync.PinnedGroup
import com.ardia.sync.PinnedSection
import com.ardia.sync.PinnedTile
import com.ardia.sync.SyncPhase
import com.ardia.sync.SyncedProfile
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlin.math.max

@Composable
fun SyncedSpacesView(model: AppModel, modifier: Modifier = Modifier) {
    val dark = LocalArdiaDarkTheme.current
    val contrast = LocalIncreasedContrast.current
    val reduceMotion = LocalReduceMotion.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val profiles = model.syncSnapshot.profiles
    var selection by rememberSaveable { mutableStateOf(model.selectedProfile?.syncId ?: profiles.firstOrNull()?.syncId) }
    val current = profiles.firstOrNull { it.syncId == selection } ?: profiles.firstOrNull()
    val tones = SpaceTone.colors(current, dark, contrast)
    val toneSpec = if (reduceMotion) Motion.reducedFade.spec<Color>() else androidx.compose.animation.core.tween(300)
    val top by animateColorAsState(tones.first(), toneSpec, label = "spaceTop")
    val bottom by animateColorAsState(tones.last(), toneSpec, label = "spaceBottom")
    BackHandler { model.sheet = null }
    Column(
        modifier
            .fillMaxSize()
            .background(if (dark) Color.Black else Color.White)
            .background(Brush.verticalGradient(listOf(top, bottom)))
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .testTag(SPACES_TAG),
    ) {
        SpacesHeader(
            title = current?.name ?: stringResource(R.string.spaces_title),
            archive = model::openArchive,
            close = { model.sheet = null },
        )
        SyncStatusBanner(model.syncState.phase, model.syncState.statusText) { model.sheet = AppModel.Sheet.Settings }
        if (profiles.isEmpty()) {
            val isOff = model.syncState.phase == SyncPhase.Off
            SpacesUnavailable(isOff, Modifier.weight(1f)) {
                model.sheet = if (isOff) AppModel.Sheet.SyncSetup else AppModel.Sheet.Settings
            }
            return@Column
        }
        val initialPage = profiles.indexOfFirst { it.syncId == selection }.coerceAtLeast(0)
        val pager = rememberPagerState(initialPage = initialPage) { profiles.size }
        LaunchedEffect(pager, profiles) {
            snapshotFlow { pager.settledPage }.distinctUntilChanged().collect { page ->
                val id = profiles.getOrNull(page)?.syncId ?: return@collect
                if (id == selection) return@collect
                selection = id
                haptics.selection()
                if (id != model.tabStore?.profileSyncId) model.switchProfile(id)
            }
        }
        HorizontalPager(pager, Modifier.weight(1f), key = { profiles[it].syncId }) { page ->
            SpacePage(model, profiles[page])
        }
        if (profiles.size > 1) {
            SpaceSwitcher(profiles, pager.currentPage) { index ->
                scope.launch { if (reduceMotion) pager.scrollToPage(index) else pager.animateScrollToPage(index) }
            }
        }
    }
}

@Composable
private fun SpacesHeader(title: String, archive: () -> Unit, close: () -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    Row(
        Modifier.fillMaxWidth().padding(start = Spacing.medium + 4.dp, end = Spacing.page, top = Spacing.medium, bottom = Spacing.tight),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        Text(
            title,
            style = ArdiaType.title2.semibold,
            color = SystemPalette.label.resolve(dark),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        HeaderButton(ArdiaSymbols.archivebox, stringResource(R.string.spaces_archive), archive)
        HeaderButton(ArdiaSymbols.xmark, stringResource(R.string.spaces_close), close)
    }
}

@Composable
private fun HeaderButton(symbol: ImageVector, label: String, action: () -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    val ink = SystemPalette.label.resolve(dark)
    Box(
        Modifier
            .size(44.dp)
            .clickable(onClick = action)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                onClick { action(); true }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(32.dp).background(ink.copy(alpha = 0.1f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(symbol, null, Modifier.size(15.dp), tint = SystemPalette.secondaryLabel.resolve(dark))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SpacePage(model: AppModel, profile: SyncedProfile) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var expandedDevices by rememberSaveable(profile.syncId) { mutableStateOf(emptySet<String>()) }
    var expandedGroups by rememberSaveable(profile.syncId) { mutableStateOf(emptySet<String>()) }
    val devices = remember(profile) { profile.deviceTabs.filter { it.tabs.isNotEmpty() } }
    val links = remember(model, profile.syncId) { RemoteLinks(model, profile.syncId) }
    val toggle = { key: String -> expandedGroups = if (key in expandedGroups) expandedGroups - key else expandedGroups + key }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                runCatching { model.syncNow() }
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            Modifier.fillMaxSize().testTag(spacePageTag(profile.syncId)),
            contentPadding = WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom).asPaddingValues(),
        ) {
            if (profile.pinned.tiles.isNotEmpty()) {
                item(key = "tiles") {
                    PinnedTileGrid(profile.pinned.tiles, links::open, Modifier.padding(start = Spacing.medium, end = Spacing.medium, top = Spacing.tight, bottom = Spacing.small))
                }
            }
            pinnedSections(profile.pinned.sections, depth = 0, expanded = expandedGroups, toggle = toggle, links = links)
            if (profile.bookmarks.isNotEmpty()) {
                item(key = "bookmarks-header") { SectionHeader(stringResource(R.string.spaces_bookmarks), ArdiaSymbols.star) }
                bookmarks(profile.bookmarks, depth = 0, expanded = expandedGroups, toggle = toggle, links = links)
            }
            for (device in devices) {
                deviceSection(device, device.deviceId in expandedDevices, links) { expandedDevices = expandedDevices + device.deviceId }
            }
            if (profile.pinned.isEmpty && devices.isEmpty() && profile.bookmarks.isEmpty()) {
                item(key = "empty") { NothingHereYet(profile.name) }
            }
        }
    }
}

private fun LazyListScope.pinnedSections(
    sections: List<PinnedSection>,
    depth: Int,
    expanded: Set<String>,
    toggle: (String) -> Unit,
    links: RemoteLinks,
) {
    for (section in sections) {
        val tab = section.tab
        val group = section.group
        when {
            tab != null -> item(key = "pinned:${section.id}:$depth") {
                RemoteRow(tab.title, tab.url, depth, links, SpaceColors.symbol(tab.icon))
            }
            group != null -> {
                val key = "group:${group.key}"
                val isOpen = key in expanded
                item(key = key) { GroupRow(group, depth, isOpen) { toggle(key) } }
                if (isOpen) pinnedSections(group.items, depth + 1, expanded, toggle, links)
            }
        }
    }
}

private fun LazyListScope.bookmarks(
    items: List<BookmarkItem>,
    depth: Int,
    expanded: Set<String>,
    toggle: (String) -> Unit,
    links: RemoteLinks,
) {
    for (bookmark in items) {
        val url = bookmark.url
        if (url != null) {
            item(key = "bookmark:${bookmark.key}") { RemoteRow(bookmark.title, url, depth, links) }
            continue
        }
        val key = "folder:${bookmark.key}"
        val isOpen = key in expanded
        item(key = key) {
            FolderRow(bookmark.title, ArdiaSymbols.folderFill, null, depth, isOpen) { toggle(key) }
        }
        if (isOpen) bookmarks(bookmark.children.orEmpty(), depth + 1, expanded, toggle, links)
    }
}

private fun LazyListScope.deviceSection(device: DeviceTabs, isExpanded: Boolean, links: RemoteLinks, expand: () -> Unit) {
    val expanded = isExpanded || device.tabs.size <= COLLAPSED_LIMIT + 1
    item(key = "device:${device.deviceId}") { SectionHeader(device.deviceName, SpaceColors.device(device.deviceName, device.kind)) }
    val shown = if (expanded) device.tabs else device.tabs.take(COLLAPSED_LIMIT)
    items(shown, key = { "remote:${device.deviceId}:${it.id}" }) { tab -> RemoteRow(tab.title, tab.url, 0, links) }
    if (!expanded) item(key = "more:${device.deviceId}") { ShowAllRow(expand) }
}

@Composable
private fun SectionHeader(title: String, icon: ImageVector) {
    val dark = LocalArdiaDarkTheme.current
    val ink = SystemPalette.secondaryLabel.resolve(dark)
    Row(
        Modifier.fillMaxWidth().padding(start = Spacing.medium, end = Spacing.medium, top = Spacing.small + Spacing.small, bottom = 4.dp).semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, Modifier.size(15.dp), tint = ink)
        Text(title, style = ArdiaType.footnote.semibold, color = ink)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RemoteRow(title: String, url: String, depth: Int, links: RemoteLinks, symbol: ImageVector? = null) {
    val dark = LocalArdiaDarkTheme.current
    val fontScale = LocalDensity.current.fontScale
    var menu by remember { mutableStateOf(false) }
    val iconSide = (24 * fontScale.coerceAtMost(40f / 24f)).dp
    val label = TabText.remoteTitle(title, url)
    val open = { links.open(url, title) }
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .combinedClickable(onLongClick = { menu = true }, onClick = open)
                .padding(start = Spacing.medium + INDENT * depth, end = Spacing.medium),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        ) {
            Box(Modifier.size(iconSide), contentAlignment = Alignment.Center) {
                if (symbol != null) {
                    Icon(symbol, null, Modifier.size(iconSide * 0.8f), tint = SystemPalette.secondaryLabel.resolve(dark))
                } else {
                    FaviconImage(null, url, size = iconSide - 2.dp)
                }
            }
            Text(
                label,
                style = ArdiaType.body.medium,
                color = SystemPalette.label.resolve(dark),
                maxLines = if (fontScale >= LARGE_FONT_SCALE) 3 else 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            MenuRow(stringResource(R.string.spaces_open), ArdiaSymbols.arrowUpForwardSquare) {
                menu = false
                open()
            }
            if (BrowserUrl.isSyncable(url)) {
                MenuRow(stringResource(R.string.spaces_copy_link), ArdiaSymbols.link) {
                    menu = false
                    links.copy(url)
                }
                MenuRow(stringResource(R.string.spaces_share), ArdiaSymbols.squareAndArrowUp) {
                    menu = false
                    links.share(url, label)
                }
            }
        }
    }
}

@Composable
private fun GroupRow(group: PinnedGroup, depth: Int, isOpen: Boolean, toggle: () -> Unit) {
    FolderRow(group.name, SpaceColors.symbol(group.icon) ?: ArdiaSymbols.folderFill, SpaceColors.color(group.color), depth, isOpen, toggle)
}

@Composable
private fun FolderRow(title: String, icon: ImageVector, tint: Color?, depth: Int, isOpen: Boolean, toggle: () -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    val secondary = SystemPalette.secondaryLabel.resolve(dark)
    val turn by animateFloatAsState(if (isOpen) 90f else 0f, Motion.snappy.spec(), label = "disclosure")
    val state = stringResource(if (isOpen) R.string.spaces_collapse else R.string.spaces_expand)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(onClickLabel = state, onClick = toggle)
            .semantics { stateDescription = state }
            .padding(start = Spacing.medium + INDENT * depth, end = Spacing.medium),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        Icon(icon, null, Modifier.widthIn(min = 24.dp).size(20.dp), tint = tint ?: secondary)
        Text(title, style = ArdiaType.body.medium, color = SystemPalette.label.resolve(dark), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Icon(ArdiaSymbols.chevronRight, null, Modifier.size(14.dp).rotate(turn), tint = secondary)
    }
}

@Composable
private fun ShowAllRow(expand: () -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    Text(
        stringResource(R.string.spaces_show_all),
        style = ArdiaType.subheadline.semibold,
        color = SystemPalette.secondaryLabel.resolve(dark),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable(role = Role.Button, onClick = expand)
            .padding(horizontal = Spacing.medium, vertical = 12.dp),
    )
}

@Composable
private fun PinnedTileGrid(tiles: List<PinnedTile>, open: (String, String) -> Unit, modifier: Modifier = Modifier) {
    val fontScale = LocalDensity.current.fontScale
    val height = minOf(56f * fontScale, 72f).dp
    val showsTitle = fontScale < LARGE_FONT_SCALE
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val spacing = Spacing.tight
        val columns = max(1, ((maxWidth + spacing) / (TILE_MIN_WIDTH + spacing)).toInt())
        Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
            for (row in tiles.chunked(columns)) {
                Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
                    for (tile in row) PinnedTileView(tile, height, showsTitle, open, Modifier.weight(1f))
                    repeat(columns - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PinnedTileView(tile: PinnedTile, height: Dp, showsTitle: Boolean, open: (String, String) -> Unit, modifier: Modifier = Modifier) {
    val dark = LocalArdiaDarkTheme.current
    val folder = tile.folder?.takeIf { it.isNotEmpty() }
    var menu by remember { mutableStateOf(false) }
    val label = TabText.remoteTitle(tile.title, tile.url).let { if (tile.title.isEmpty()) BrowserUrl.host(tile.url).orEmpty() else it }
    Box(modifier) {
        Column(
            Modifier
                .fillMaxWidth()
                .clickable { if (folder != null) menu = true else open(tile.url, tile.title) }
                .clearAndSetSemantics {
                    contentDescription = label
                    role = Role.Button
                    onClick {
                        if (folder != null) menu = true else open(tile.url, tile.title)
                        true
                    }
                },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(height)
                    .background(if (dark) Color.White.copy(alpha = 0.1f) else Color.White.copy(alpha = 0.7f), RoundedCornerShape(TabsLayout.tileRadius)),
                contentAlignment = Alignment.Center,
            ) {
                if (folder != null) {
                    Icon(ArdiaSymbols.folderFill, null, Modifier.size(22.dp), tint = SystemPalette.secondaryLabel.resolve(dark))
                } else {
                    FaviconImage(null, tile.url, size = 24.dp)
                }
            }
            if (showsTitle) {
                Text(label, style = ArdiaType.caption.medium, color = SystemPalette.secondaryLabel.resolve(dark), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (folder != null) {
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                for (tab in folder) {
                    MenuRow(TabText.remoteTitle(tab.title, tab.url), null) {
                        menu = false
                        open(tab.url, tab.title)
                    }
                }
            }
        }
    }
}

@Composable
private fun SpaceSwitcher(profiles: List<SyncedProfile>, selected: Int, choose: (Int) -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    val ink = SystemPalette.label.resolve(dark)
    Box(
        Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
            .padding(start = Spacing.page, end = Spacing.page, top = Spacing.tight, bottom = Spacing.hairline),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .height(44.dp)
                .background(ink.copy(alpha = 0.06f), CircleShape)
                .border(0.5.dp, ink.copy(alpha = 0.15f), CircleShape)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = Spacing.tight),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            profiles.forEachIndexed { index, profile ->
                val isSelected = index == selected
                Box(
                    Modifier
                        .size(52.dp, 36.dp)
                        .clickable { choose(index) }
                        .clearAndSetSemantics {
                            contentDescription = profile.name
                            role = Role.Tab
                            this.selected = isSelected
                            onClick { choose(index); true }
                        }
                        .graphicsLayer { alpha = if (isSelected) 1f else 0.35f },
                    contentAlignment = Alignment.Center,
                ) {
                    val symbol = SpaceColors.symbol(profile.icon)
                    if (symbol != null) {
                        Icon(symbol, null, Modifier.size(20.dp), tint = ink)
                    } else {
                        Box(Modifier.size(9.dp).background(ink, CircleShape))
                    }
                }
            }
        }
    }
}

@Composable
private fun SyncStatusBanner(phase: SyncPhase, status: String, openSettings: () -> Unit) {
    val symbol = when (phase) {
        SyncPhase.NeedsFolderAccess -> ArdiaSymbols.folderFill
        SyncPhase.Locked -> ArdiaSymbols.named("lock.fill") ?: ArdiaSymbols.exclamationmarkTriangleFill
        SyncPhase.Reset -> ArdiaSymbols.arrowClockwise
        is SyncPhase.Stalled -> ArdiaSymbols.exclamationmarkTriangleFill
        SyncPhase.Offline -> ArdiaSymbols.named("wifi.slash") ?: ArdiaSymbols.exclamationmarkTriangleFill
        else -> null
    } ?: return
    val needsAction = phase == SyncPhase.NeedsFolderAccess || phase == SyncPhase.Locked || phase == SyncPhase.Reset
    val dark = LocalArdiaDarkTheme.current
    val ink = SystemPalette.label.resolve(dark)
    Row(
        Modifier
            .padding(start = Spacing.page, end = Spacing.page, bottom = Spacing.tight)
            .fillMaxWidth()
            .background(ink.copy(alpha = 0.08f), RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(symbol, null, Modifier.size(18.dp), tint = ORANGE)
        Text(status, style = ArdiaType.subheadline, color = ink, modifier = Modifier.weight(1f))
        if (needsAction) {
            OutlinedButton(onClick = openSettings) { Text(stringResource(R.string.spaces_fix), style = ArdiaType.subheadline.semibold) }
        }
    }
}

@Composable
private fun SpacesUnavailable(isOff: Boolean, modifier: Modifier = Modifier, action: () -> Unit) {
    val dark = LocalArdiaDarkTheme.current
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 320.dp).padding(Spacing.large),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(ArdiaSymbols.macbookAndIphone, null, Modifier.size(48.dp), tint = SystemPalette.secondaryLabel.resolve(dark))
            Text(stringResource(R.string.spaces_unavailable_title), style = ArdiaType.title2.semibold, color = SystemPalette.label.resolve(dark), textAlign = TextAlign.Center)
            Text(
                stringResource(if (isOff) R.string.spaces_unavailable_off else R.string.spaces_unavailable_waiting),
                style = ArdiaType.subheadline,
                color = SystemPalette.secondaryLabel.resolve(dark),
                textAlign = TextAlign.Center,
            )
            Button(
                onClick = action,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Palette.primaryAction.resolve(dark), contentColor = Palette.onPrimaryAction.resolve(dark)),
                modifier = Modifier.padding(top = 6.dp),
            ) {
                Text(stringResource(if (isOff) R.string.spaces_sync_with_mac else R.string.spaces_sync_settings), style = ArdiaType.body.semibold)
            }
        }
    }
}

@Composable
private fun NothingHereYet(name: String) {
    val dark = LocalArdiaDarkTheme.current
    Column(
        Modifier.fillMaxWidth().padding(top = Spacing.section, start = Spacing.large, end = Spacing.large),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(ArdiaSymbols.squareStack, null, Modifier.size(40.dp), tint = SystemPalette.secondaryLabel.resolve(dark))
        Text(stringResource(R.string.spaces_nothing_here), style = ArdiaType.title3.semibold, color = SystemPalette.label.resolve(dark), textAlign = TextAlign.Center)
        Text(
            stringResource(R.string.spaces_nothing_here_message, name),
            style = ArdiaType.subheadline,
            color = SystemPalette.secondaryLabel.resolve(dark),
            textAlign = TextAlign.Center,
        )
    }
}

@Stable
private class RemoteLinks(private val model: AppModel, private val profileId: String) {
    fun open(url: String, title: String) = model.openRemote(url, title, profileId)

    fun copy(url: String) = model.copyLink(url)

    fun share(url: String, title: String) = model.share(url, title)
}

const val SPACES_TAG = "tabs.spaces"

fun spacePageTag(syncId: String): String = "tabs.spaces.page.$syncId"
private const val COLLAPSED_LIMIT = 8
private val INDENT = 20.dp
private val TILE_MIN_WIDTH = 72.dp
private val ORANGE = Color(0xFFFF9500)
