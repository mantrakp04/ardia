import { listTasks, type EngineTask } from "../../platform/performance";
import { onExtensionsChanged } from "../../platform/extensions";
import { currentAppIcon, onAppEvent } from "../../platform/app";
import { useTranslate } from "../site/translate";
import { useBrowser, type BrowserState } from "../browser/store";
import { takeSnapshotWrites, useSync } from "../sync/engine";
import { takeSyncCodeCounts } from "../sync/recoveryKit";
import { capture, endSession, flush, isSharing, markSettingsSnapshot, settingsSnapshotDay, startClient } from "./client";
import { reportLocalStore, startLocalStore } from "./localStoreReport";
import { startWatchChecks } from "./watch";
import { appIconSetting, customColorProfiles, SETTINGS_SNAPSHOT_EVENT, settingsSnapshot } from "./settingsSnapshot";
import { utcDay } from "./daily";
import { appInfo, percentile } from "./transport";
import { reportNativeCrashes } from "./errors";
import { emitJourneys, journeysEnding, startJourneys } from "./journeys";
import { commandBarPlacementLabel, takeOmniboxLatency, takeSearchSuggests } from "./track";
import { contextProperties, contextSamples, hardwareProperties, noteAppMemory, recordContext, startContextSamples, stopContextSamples, watchHoverLost } from "./diagnostics";
import { emitTabPresses } from "./tabPresses";
import { switcherSwitchProperties } from "./switcherPresses";
import type { SavedContext } from "./savedContext";
import { splitTabIds } from "../splits/splits";
import { windowsRealignedToAutoHideTabsAtLaunch } from "../session/persist";
import { takeAutoHideTabsChoices } from "./autoHideTabsChoices";
import { takeTabSwitcherOpensInWebKit } from "./tabSwitcherOpens";
import { takeTabSleepCounts } from "./tabSleepCounts";
import { noteAutoPictureInPictureNothingPlaying, takePictureInPictureCounts } from "./pictureInPictureCounts";
import { useToolbarAutoHide } from "../windows/toolbarAutoHide";
import { toolbarBounces } from "./toolbarBounces";
import { takeStuckDragCounts } from "./stuckDrags";
import { takeUrlCopyCounts } from "./urlCopies";

const HOUR_MS = 60 * 60_000;
const FIRST_MEMORY_SAMPLE_MS = 10 * 60_000;
const FIRST_SETTINGS_SNAPSHOT_MS = 2 * 60_000;
const EXTENSION_SETTLE_MS = 20_000;
const LOCAL_STORE_LAUNCH_DELAY_MS = 20_000;

const startedAt = Date.now();
const NO_COUNTS = { tabs: 0, windows: 0, fullScreens: 0, sidebarPeeks: 0, sidebarPeekBounces: 0, cliTabEdits: 0, cliGroupEdits: 0, cliEditFailures: 0, cliPillShows: 0, popoverPressCloses: 0, popoverEscapeCloses: 0, tabSwitcherOpens: 0, tabSwitcherClosedLeftOut: 0, tabSwitcherUnseenLast: 0, approvalNoticesDeferred: 0, reopenedPages: 0, reopenedPagesWithBack: 0, groupTabsKept: 0, groupHeaderHides: 0, peekPinchOpens: 0, peekPinchCloses: 0, littleArdiaPinchOpens: 0, littleArdiaPinchCloses: 0, externalLinksTabSettingOff: 0, externalLinksTabSettingOn: 0, externalLinksLittleSettingOn: 0, externalLinksLittleSettingOff: 0, autoHideTabsToggles: 0, windowsRealignedToAutoHideTabs: 0, tabStripPeeks: 0, tabPeeksWithAutoHideOff: 0, toolbarScrollHides: 0, toolbarScrollHideBounces: 0, cardResizeLayouts: 0, cardResizeLayoutsApplied: 0, importedPinnedRows: 0, importedSplits: 0, importedSpaces: 0, importedContainerSpaces: 0, importedDataProfiles: 0, importedEssentials: 0, splitPaneCloses: 0, splitViewCloses: 0, windowCloseTabsKept: 0, sharesPickedTab: 0, sharesPickedWindow: 0, sharesPickedScreen: 0, screenRecordingMissing: 0, screenRecordingAsked: 0, extensionInstallPrompts: 0, privateWindowExtensionOpens: 0, contentBlockerUnavailable: 0, contentBlockerWriteFailures: 0, newTabNoticesShown: 0, newTabNoticePresses: 0, statusBubbleTopShows: 0, dockReopens: 0, dockReopensPastFloating: 0, sidebarMotionMerges: 0, webKitPagesKeptHidden: 0, newTabBarKeeps: 0, newTabReuses: 0, barSplitOpens: 0, barSplitFullTabs: 0, settingsSearchKeyboardReveals: 0, settingsSearchClickReveals: 0, settingsSearches: 0, settingsSearchesEmpty: 0, settingsSearchTopPicks: 0, settingsSearchTop3Picks: 0, settingsSearchLowerPicks: 0, autoPictureInPictureKept: 0, autoPictureInPictureStayedOnAppSwitch: 0, selectionCloseKeys: 0, selectionCloseKeyTabs: 0, onboardingImports: 0, onboardingHeliumImports: 0, onboardingGlassPicks: 0, onboardingClassicPicks: 0, onboardingTintedGlassPicks: 0, onboardingStepsCompleted: 0, onboardingStepsSkipped: 0, onboardingCustomizeMore: 0, onboardingRedoOpened: 0, onboardingRedoCompleted: 0, onboardingRedoCancelled: 0, updateChannelSwitches: 0, updateChannelSwitchOffers: 0, updateChannelSwitchUpToDate: 0, updateChannelSwitchCheckFailures: 0 };
let counts = { ...NO_COUNTS }, countsSince = Date.now();

function emitCounts() {
  const snapshots = takeSnapshotWrites(), switcherOpensInWebKit = takeTabSwitcherOpensInWebKit(), stuckDrags = takeStuckDragCounts(), urlCopies = takeUrlCopyCounts(), tabSleeps = takeTabSleepCounts(), syncCodes = takeSyncCodeCounts();
  const { nothingPlaying: autoPictureInPictureNothingPlaying, backToTab } = takePictureInPictureCounts();
  counts.autoHideTabsToggles += takeAutoHideTabsChoices();
  if (Object.values(counts).some(Boolean) || Object.values(tabSleeps).some(Boolean) || Object.values(syncCodes).some(Boolean) || Object.values(stuckDrags).some(Boolean) || urlCopies.url_copies || snapshots.count || switcherOpensInWebKit || autoPictureInPictureNothingPlaying || backToTab.chromium || backToTab.webkit) {
    capture("usage_counts", {
      tabs_opened: counts.tabs,
      windows_opened: counts.windows,
      full_screens_entered: counts.fullScreens,
      sidebar_peeks: counts.sidebarPeeks,
      sidebar_peek_bounces: counts.sidebarPeekBounces,
      cli_tab_edits: counts.cliTabEdits,
      cli_group_edits: counts.cliGroupEdits,
      cli_edit_failures: counts.cliEditFailures,
      cli_pill_shows: counts.cliPillShows,
      ...stuckDrags, ...urlCopies, ...tabSleeps, ...syncCodes,
      popover_press_closes: counts.popoverPressCloses,
      popover_escape_closes: counts.popoverEscapeCloses,
      tab_switcher_opens: counts.tabSwitcherOpens,
      tab_switcher_opens_in_webkit: switcherOpensInWebKit,
      tab_switcher_closed_left_out: counts.tabSwitcherClosedLeftOut,
      tab_switcher_unseen_last: counts.tabSwitcherUnseenLast,
      approval_notices_deferred: counts.approvalNoticesDeferred,
      reopened_pages: counts.reopenedPages,
      reopened_pages_with_back: counts.reopenedPagesWithBack,
      group_tabs_kept: counts.groupTabsKept,
      group_header_hides: counts.groupHeaderHides,
      sidebar_motion_merges: counts.sidebarMotionMerges,
      peek_pinch_opens: counts.peekPinchOpens,
      peek_pinch_closes: counts.peekPinchCloses,
      little_ardia_pinch_opens: counts.littleArdiaPinchOpens,
      little_ardia_pinch_closes: counts.littleArdiaPinchCloses, external_links_tab_setting_off: counts.externalLinksTabSettingOff, external_links_tab_setting_on: counts.externalLinksTabSettingOn, external_links_little_setting_on: counts.externalLinksLittleSettingOn, external_links_little_setting_off: counts.externalLinksLittleSettingOff,
      auto_hide_tabs_toggles: counts.autoHideTabsToggles,
      windows_realigned_to_auto_hide_tabs: counts.windowsRealignedToAutoHideTabs,
      tab_strip_peeks: counts.tabStripPeeks,
      tab_peeks_with_auto_hide_off: counts.tabPeeksWithAutoHideOff,
      imported_pinned_rows: counts.importedPinnedRows,
      imported_splits: counts.importedSplits, imported_spaces: counts.importedSpaces, imported_container_spaces: counts.importedContainerSpaces, imported_data_profiles: counts.importedDataProfiles, imported_essentials: counts.importedEssentials,
      split_pane_closes: counts.splitPaneCloses,
      split_view_closes: counts.splitViewCloses,
      window_close_tabs_kept: counts.windowCloseTabsKept,
      sync_snapshots_written: snapshots.count,
      sync_snapshot_kb_written: Math.round(snapshots.bytes / 1024), auto_pip_nothing_playing: autoPictureInPictureNothingPlaying, pip_back_to_tab: backToTab.chromium, pip_back_to_tab_webkit: backToTab.webkit,
      toolbar_scroll_hides: counts.toolbarScrollHides,
      toolbar_scroll_hide_bounces: counts.toolbarScrollHideBounces,
      card_resize_layouts: counts.cardResizeLayouts,
      card_resize_layouts_applied: counts.cardResizeLayoutsApplied,
      shares_picked_tab: counts.sharesPickedTab,
      shares_picked_window: counts.sharesPickedWindow,
      shares_picked_screen: counts.sharesPickedScreen,
      share_picker_screen_recording_missing: counts.screenRecordingMissing,
      share_picker_screen_recording_asked: counts.screenRecordingAsked,
      extension_install_prompts: counts.extensionInstallPrompts,
      private_window_extension_opens: counts.privateWindowExtensionOpens,
      content_blocker_unavailable: counts.contentBlockerUnavailable,
      content_blocker_write_failures: counts.contentBlockerWriteFailures,
      new_tab_notices_shown: counts.newTabNoticesShown,
      new_tab_notice_presses: counts.newTabNoticePresses,
      status_bubble_top_shows: counts.statusBubbleTopShows,
      new_tab_bar_keeps: counts.newTabBarKeeps, new_tab_reuses: counts.newTabReuses, bar_split_opens: counts.barSplitOpens, bar_split_full_tabs: counts.barSplitFullTabs,
      dock_reopens: counts.dockReopens, dock_reopens_past_floating: counts.dockReopensPastFloating, webkit_pages_kept_hidden: counts.webKitPagesKeptHidden,
      settings_search_keyboard_reveals: counts.settingsSearchKeyboardReveals, settings_search_click_reveals: counts.settingsSearchClickReveals, settings_searches: counts.settingsSearches, settings_searches_empty: counts.settingsSearchesEmpty, settings_search_top_picks: counts.settingsSearchTopPicks, settings_search_top3_picks: counts.settingsSearchTop3Picks, settings_search_lower_picks: counts.settingsSearchLowerPicks,
      auto_pip_kept_visible: counts.autoPictureInPictureKept, auto_pip_stayed_on_app_switch: counts.autoPictureInPictureStayedOnAppSwitch, selection_close_keys: counts.selectionCloseKeys, selection_close_key_tabs: counts.selectionCloseKeyTabs,
      onboarding_imports: counts.onboardingImports, onboarding_helium_imports: counts.onboardingHeliumImports, onboarding_glass_picks: counts.onboardingGlassPicks, onboarding_classic_picks: counts.onboardingClassicPicks, onboarding_tinted_glass_picks: counts.onboardingTintedGlassPicks, onboarding_steps_completed: counts.onboardingStepsCompleted, onboarding_steps_skipped: counts.onboardingStepsSkipped, onboarding_customize_more: counts.onboardingCustomizeMore, onboarding_redo_opened: counts.onboardingRedoOpened, onboarding_redo_completed: counts.onboardingRedoCompleted, onboarding_redo_cancelled: counts.onboardingRedoCancelled,
      update_channel_switches: counts.updateChannelSwitches, update_channel_switch_offers: counts.updateChannelSwitchOffers, update_channel_switch_up_to_date: counts.updateChannelSwitchUpToDate, update_channel_switch_check_failures: counts.updateChannelSwitchCheckFailures, period_minutes: Math.round((Date.now() - countsSince) / 60_000),
    });
  }
  counts = { ...NO_COUNTS };
  countsSince = Date.now();
}

export const noteImportedPins = (made: { rows: number; splits: number }) => void ((counts.importedPinnedRows += made.rows), (counts.importedSplits += made.splits));

export const noteImportedSpaces = (made: { spaces: number; containerSpaces: number; dataProfiles: number; essentials: number }) => void ((counts.importedSpaces += made.spaces), (counts.importedContainerSpaces += made.containerSpaces), (counts.importedDataProfiles += made.dataProfiles), (counts.importedEssentials += made.essentials));

export const noteOnboardingImport = (source: string) => void (counts.onboardingImports++, source === "helium" && counts.onboardingHeliumImports++);

export const noteOnboarding = (event: "stepCompleted" | "stepSkipped" | "customizeMore" | "redoOpened" | "redoCompleted" | "redoCancelled") => void counts[(({ stepCompleted: "onboardingStepsCompleted", stepSkipped: "onboardingStepsSkipped", customizeMore: "onboardingCustomizeMore", redoOpened: "onboardingRedoOpened", redoCompleted: "onboardingRedoCompleted", redoCancelled: "onboardingRedoCancelled" }) as const)[event]]++;

export const noteOnboardingStyle = (style: "glass" | "classic", tinted: boolean) => void (counts[style === "glass" ? "onboardingGlassPicks" : "onboardingClassicPicks"]++, style === "glass" && tinted && counts.onboardingTintedGlassPicks++);

export const noteSplit = (count: "splitPaneCloses" | "splitViewCloses" | "barSplitOpens" | "barSplitFullTabs") => void counts[count]++;

export const noteWindowCloseTabsKept = (n: number) => void (counts.windowCloseTabsKept += n);

export const noteSelectionClosedByKey = (tabs: number) => void ((counts.selectionCloseKeys += 1), (counts.selectionCloseKeyTabs += tabs));

export const noteSharePicked = (kind: "tab" | "window" | "screen") => void counts[kind === "tab" ? "sharesPickedTab" : kind === "window" ? "sharesPickedWindow" : "sharesPickedScreen"]++;

export const noteScreenRecordingMissing = () => counts.screenRecordingMissing++;
export const noteScreenRecordingAsked = () => counts.screenRecordingAsked++;

export const noteWebKitPageKeptHidden = () => counts.webKitPagesKeptHidden++;

export const noteAutoPictureInPictureKept = (reason: "onScreen" | "appSwitch" | "nothingPlaying") => reason === "nothingPlaying" ? noteAutoPictureInPictureNothingPlaying() : counts[reason === "appSwitch" ? "autoPictureInPictureStayedOnAppSwitch" : "autoPictureInPictureKept"]++;

export const noteExtensionInstallPrompt = () => counts.extensionInstallPrompts++;

export const notePrivateWindowExtensionOpen = () => counts.privateWindowExtensionOpens++;

export const noteContentBlockerUnavailable = () => counts.contentBlockerUnavailable++;
export const noteContentBlockerWriteFailure = () => counts.contentBlockerWriteFailures++;

export function noteCliEdits(tabEdits: number, groupEdits: number, failures: number) {
  counts.cliTabEdits += tabEdits;
  counts.cliGroupEdits += groupEdits;
  counts.cliEditFailures += failures;
}

const OVERLAY_COUNTS = { newTabShown: "newTabNoticesShown", newTabPressed: "newTabNoticePresses", statusAtTop: "statusBubbleTopShows", newTabBarKept: "newTabBarKeeps", newTabReused: "newTabReuses" } as const;
export const notePageOverlay = (event: keyof typeof OVERLAY_COUNTS) => void counts[OVERLAY_COUNTS[event]]++;

export const noteCliPillShown = () => counts.cliPillShows++;

export const notePopoverClosed = (by: "press" | "escape") => void counts[by === "press" ? "popoverPressCloses" : "popoverEscapeCloses"]++;

export const noteUpdateChannelSwitch = (outcome: "offered" | "upToDate" | "failed" | null) => void (counts.updateChannelSwitches++, outcome && counts[outcome === "offered" ? "updateChannelSwitchOffers" : outcome === "upToDate" ? "updateChannelSwitchUpToDate" : "updateChannelSwitchCheckFailures"]++);

export const noteTabSwitcherOpened = (closedLeftOut: number, unseenLast: number) =>
  void (counts.tabSwitcherOpens++, (counts.tabSwitcherClosedLeftOut += closedLeftOut), (counts.tabSwitcherUnseenLast += unseenLast));

export const noteApprovalNoticeDeferred = () => counts.approvalNoticesDeferred++;

export function noteDockReopen(pastFloating: boolean) {
  counts.dockReopens++;
  if (pastFloating) counts.dockReopensPastFloating++;
}

export function noteReopenedPage(canGoBack: boolean) {
  counts.reopenedPages++;
  if (canGoBack) counts.reopenedPagesWithBack++;
}

export const notePinch = (on: "peek" | "littleArdia", outcome: "open" | "close") => void counts[on === "peek" ? (outcome === "open" ? "peekPinchOpens" : "peekPinchCloses") : outcome === "open" ? "littleArdiaPinchOpens" : "littleArdiaPinchCloses"]++;

export const noteExternalLink = (opened: "tab" | "littleArdia", settingOn: boolean) => void counts[opened === "tab" ? (settingOn ? "externalLinksTabSettingOn" : "externalLinksTabSettingOff") : settingOn ? "externalLinksLittleSettingOn" : "externalLinksLittleSettingOff"]++;

export const noteGroupHeaderHide = () => counts.groupHeaderHides++;

export const noteSidebarMotionMerge = () => counts.sidebarMotionMerges++;

export function keptTabsAdded(groups: BrowserState["groups"], prev: BrowserState["groups"]): number {
  const added = new Set<string>();
  for (const id in groups) {
    const shown = groups[id]!.shownTabIds;
    if (!shown || shown === prev[id]?.shownTabIds) continue;
    for (const tabId of shown) if (!prev[id]?.shownTabIds?.includes(tabId)) added.add(tabId);
  }
  return added.size;
}

export function noteCardResizeLayout(applied: boolean) {
  if (applied) counts.cardResizeLayoutsApplied++;
  else counts.cardResizeLayouts++;
}

export function noteSidebarPeek(bounce: boolean) {
  counts.sidebarPeeks++;
  if (bounce) counts.sidebarPeekBounces++;
  if (!useBrowser.getState().settings.autoHideTabs) counts.tabPeeksWithAutoHideOff++;
}

export const noteSettingsSearchReveal = (via: "keyboard" | "click", rank: number) => void (counts[via === "keyboard" ? "settingsSearchKeyboardReveals" : "settingsSearchClickReveals"]++, counts[rank === 0 ? "settingsSearchTopPicks" : rank < 3 ? "settingsSearchTop3Picks" : "settingsSearchLowerPicks"]++);

export const noteSettingsSearch = (event: "started" | "empty") => void counts[event === "started" ? "settingsSearches" : "settingsSearchesEmpty"]++;

export function noteTabStripPeek() {
  counts.tabStripPeeks++;
  if (!useBrowser.getState().settings.autoHideTabs) counts.tabPeeksWithAutoHideOff++;
}

const size = (o: object) => Object.keys(o).length;

function watchStore() {
  let tabCount = size(useBrowser.getState().tabs);
  let windowCount = size(useBrowser.getState().windows);
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs) {
      const now = size(s.tabs);
      counts.tabs += Math.max(0, now - tabCount);
      tabCount = now;
    }
    if (s.windows !== prev.windows) {
      const now = size(s.windows);
      counts.windows += Math.max(0, now - windowCount);
      windowCount = now;
      for (const id in s.windows) {
        const w = s.windows[id]!;
        const before = prev.windows[id];
        if (before && !before.fullScreen && w.fullScreen) counts.fullScreens++;
        if (before && before.profileId !== w.profileId && w.kind !== "private") profileSwitched(size(s.profiles), switcherSwitchProperties(id, w.profileId));
      }
    }
    if (s.groups !== prev.groups) counts.groupTabsKept += keptTabsAdded(s.groups, prev.groups);
    if (s.splits !== prev.splits) {
      for (const id in s.splits) if (!prev.splits[id]) capture("split_view_opened", { panes: splitTabIds(s.splits[id]!).length });
    }
    if (s.windowUi !== prev.windowUi) {
      for (const id in s.windowUi) if (s.windowUi[id]?.panel.open && !prev.windowUi[id]?.panel.open) capture("command_bar_opened", { placement: commandBarPlacementLabel(s.windowUi[id]!.panel) });
    }
  });
}

function watchToolbarAutoHide() {
  const bounces = toolbarBounces((id) => !!useBrowser.getState().tabs[id]);
  useToolbarAutoHide.subscribe((s, prev) => {
    if (s.scrolledDown === prev.scrolledDown) return;
    const seen = bounces.note(s.scrolledDown, prev.scrolledDown);
    counts.toolbarScrollHides += seen.hides;
    counts.toolbarScrollHideBounces += seen.bounces;
  });
}

function profileSwitched(profiles: number, via: ReturnType<typeof switcherSwitchProperties>) {
  const start = Date.now();
  requestAnimationFrame(() => requestAnimationFrame(() => capture("profile_switched", { switch_ms: Date.now() - start, profiles, ...via })));
}

function watchSync() {
  let last = useSync.getState().status;
  useSync.subscribe(({ status }) => {
    const was = last;
    last = status;
    if (was === status) return;
    if (was === "off" && status !== "unavailable") capture("sync_toggled", { on: true });
    else if (status === "off" && was !== "unavailable") capture("sync_toggled", { on: false });
  });
}

function watchTranslate() {
  useTranslate.subscribe((s, prev) => {
    for (const tabId in s) if (s[tabId]?.status === "translating" && prev[tabId]?.status !== "translating") capture("translate_used");
  });
}

function watchExtensions() {
  onExtensionsChanged((e) => {
    if (e.event === "installed" && Date.now() - startedAt > EXTENSION_SETTLE_MS) capture("extension_installed");
  });
}

const mb = (bytes: number) => Math.round(bytes / 1_048_576);

async function sampleMemory() {
  try {
    await listTasks().catch((): EngineTask[] => []);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const tasks = await listTasks().catch((): EngineTask[] => []);
    let total = 0;
    let browser = 0;
    let gpu = 0;
    let renderers = 0;
    for (const t of tasks) {
      const m = Math.max(0, t.memory);
      total += m;
      if (t.type === "browser") browser += m;
      else if (t.type === "gpu") gpu += m;
      else if (t.type === "renderer") renderers++;
    }
    if (!total) return;
    noteAppMemory(mb(total));
    capture("perf_memory", {
      total_mb: mb(total),
      browser_mb: mb(browser),
      gpu_mb: mb(gpu),
      renderer_processes: renderers,
      tabs: size(useBrowser.getState().tabs),
      uptime_hours: Math.round((Date.now() - startedAt) / HOUR_MS),
    });
  } catch {}
}

function emitOmniboxLatency() {
  const samples = takeOmniboxLatency().sort((a, b) => a - b);
  if (!samples.length) return;
  const at = (p: number) => percentile(samples, p);
  capture("perf_omnibox", { ...takeSearchSuggests(), samples: samples.length, p50_ms: at(0.5), p95_ms: at(0.95), max_ms: samples.at(-1)! });
}

function snapshotSettings() {
  const today = utcDay(Date.now());
  if (settingsSnapshotDay() === today) return;
  markSettingsSnapshot(today);
  const state = useBrowser.getState();
  const settings = { ...settingsSnapshot(state.settings), ...customColorProfiles(state.profiles) };
  void currentAppIcon()
    .catch(() => null)
    .then((icon) => capture(SETTINGS_SNAPSHOT_EVENT, { ...settings, ...appIconSetting(icon) }));
}

let previousContext: SavedContext | null = null;
let launchCrashRead: ReturnType<typeof setTimeout> | undefined;

function hourly() {
  snapshotSettings();
  emitCounts();
  emitOmniboxLatency();
  emitJourneys();
  emitTabPresses();
  void sampleMemory();
  void reportNativeCrashes([previousContext, ...contextSamples()]).then(() => recordContext());
  void reportLocalStore();
}

const rebootedSince = (lastLaunchAt: number | null) => {
  const boot = appInfo().bootTime;
  return lastLaunchAt != null && boot != null ? boot > lastLaunchAt : null;
};

async function launchEvents(session: ReturnType<typeof startClient>) {
  const hardware = await hardwareProperties();
  const previous = session.previous === "unclean" ? { ...contextProperties(session.context, "prev_", Date.now()), rebooted_since: rebootedSince(session.lastLaunchAt) } : {};
  capture("app_launched", { previous_session: session.previous, ...hardware, ...previous });
  if (session.updatedFrom) capture("app_updated", { from_version: session.updatedFrom });
}

export function startUsage() {
  const session = startClient();
  previousContext = session.context;
  void launchEvents(session);
  launchCrashRead = setTimeout(() => void reportNativeCrashes([previousContext]), session.previous === "unclean" ? 1000 : 5000);
  startWatchChecks();
  startLocalStore(LOCAL_STORE_LAUNCH_DELAY_MS);
  startContextSamples();
  startJourneys(isSharing() ? session : null);
  counts.windowsRealignedToAutoHideTabs = windowsRealignedToAutoHideTabsAtLaunch();
  watchStore();
  watchToolbarAutoHide();
  watchSync();
  watchTranslate();
  watchExtensions();
  watchHoverLost();
  setTimeout(() => void sampleMemory(), FIRST_MEMORY_SAMPLE_MS);
  setTimeout(snapshotSettings, FIRST_SETTINGS_SNAPSHOT_MS);
  setInterval(hourly, HOUR_MS);
  onAppEvent((e) => {
    if (e.type === "willQuit") {
      clearTimeout(launchCrashRead);
      stopContextSamples();
      sessionEnding();
    } else if (e.type === "quitCancelled") startContextSamples();
  });
}

export function sessionEnding() {
  emitCounts();
  emitOmniboxLatency();
  emitTabPresses();
  journeysEnding();
  capture("app_session_ended", { duration_minutes: Math.round((Date.now() - startedAt) / 60_000) });
  endSession();
}

export async function devHourly() {
  hourly();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await flush();
}
