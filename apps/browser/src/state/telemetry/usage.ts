import { listTasks, type EngineTask } from "../../platform/performance";
import { onExtensionsChanged } from "../../platform/extensions";
import { currentAppIcon, onAppEvent } from "../../platform/app";
import { useTranslate } from "../site/translate";
import { useBrowser, type BrowserState } from "../browser/store";
import { takeSnapshotWrites, useSync } from "../sync/engine";
import { capture, endSession, flush, isSharing, markSettingsSnapshot, settingsSnapshotDay, startClient } from "./client";
import { reportLocalStore, startLocalStore } from "./localStoreReport";
import { startWatchChecks } from "./watch";
import { appIconSetting, customColorProfiles, SETTINGS_SNAPSHOT_EVENT, settingsSnapshot } from "./settingsSnapshot";
import { utcDay } from "./daily";
import { appInfo, percentile } from "./transport";
import { reportNativeCrashes } from "./errors";
import { emitJourneys, journeysEnding, startJourneys } from "./journeys";
import { takeOmniboxLatency } from "./track";
import { contextProperties, contextSamples, hardwareProperties, noteAppMemory, recordContext, startContextSamples, stopContextSamples } from "./diagnostics";
import { emitTabPresses } from "./tabPresses";
import { switcherSwitchProperties } from "./switcherPresses";
import type { SavedContext } from "./savedContext";
import { splitTabIds } from "../splits/splits";
import { windowsRealignedToAutoHideTabsAtLaunch } from "../session/persist";
import { takeAutoHideTabsChoices } from "./autoHideTabsChoices";
import { useToolbarAutoHide } from "../windows/toolbarAutoHide";

const HOUR_MS = 60 * 60_000;
const FIRST_MEMORY_SAMPLE_MS = 10 * 60_000;
const FIRST_SETTINGS_SNAPSHOT_MS = 2 * 60_000;
const EXTENSION_SETTLE_MS = 20_000;
const LOCAL_STORE_LAUNCH_DELAY_MS = 20_000;

const startedAt = Date.now();
const NO_COUNTS = { tabs: 0, windows: 0, captureIndicatorsCleared: 0, fullScreens: 0, sidebarPeeks: 0, sidebarPeekBounces: 0, cliTabEdits: 0, cliGroupEdits: 0, cliEditFailures: 0, cliPillShows: 0, popoverPressCloses: 0, popoverEscapeCloses: 0, tabSwitcherOpens: 0, tabSwitcherClosedLeftOut: 0, approvalNoticesDeferred: 0, reopenedPages: 0, reopenedPagesWithBack: 0, groupTabsKept: 0, groupHeaderHides: 0, peekPinchOpens: 0, peekPinchCloses: 0, littleArdiaPinchOpens: 0, littleArdiaPinchCloses: 0, autoHideTabsToggles: 0, windowsRealignedToAutoHideTabs: 0, tabStripPeeks: 0, tabPeeksWithAutoHideOff: 0, toolbarScrollHides: 0, toolbarScrollHideBounces: 0, importedPinnedRows: 0, importedSplits: 0, splitPaneCloses: 0, splitViewCloses: 0, windowCloseTabsKept: 0, sharesPickedTab: 0, sharesPickedWindow: 0, sharesPickedScreen: 0, screenRecordingMissing: 0, screenRecordingAsked: 0, extensionInstallPrompts: 0, privateWindowExtensionOpens: 0 };
let counts = { ...NO_COUNTS };
let countsSince = Date.now();

function emitCounts() {
  const snapshots = takeSnapshotWrites();
  counts.autoHideTabsToggles += takeAutoHideTabsChoices();
  if (Object.values(counts).some(Boolean) || snapshots.count) {
    capture("usage_counts", {
      tabs_opened: counts.tabs,
      windows_opened: counts.windows,
      capture_indicators_cleared: counts.captureIndicatorsCleared,
      full_screens_entered: counts.fullScreens,
      sidebar_peeks: counts.sidebarPeeks,
      sidebar_peek_bounces: counts.sidebarPeekBounces,
      cli_tab_edits: counts.cliTabEdits,
      cli_group_edits: counts.cliGroupEdits,
      cli_edit_failures: counts.cliEditFailures,
      cli_pill_shows: counts.cliPillShows,
      popover_press_closes: counts.popoverPressCloses,
      popover_escape_closes: counts.popoverEscapeCloses,
      tab_switcher_opens: counts.tabSwitcherOpens,
      tab_switcher_closed_left_out: counts.tabSwitcherClosedLeftOut,
      approval_notices_deferred: counts.approvalNoticesDeferred,
      reopened_pages: counts.reopenedPages,
      reopened_pages_with_back: counts.reopenedPagesWithBack,
      group_tabs_kept: counts.groupTabsKept,
      group_header_hides: counts.groupHeaderHides,
      peek_pinch_opens: counts.peekPinchOpens,
      peek_pinch_closes: counts.peekPinchCloses,
      little_ardia_pinch_opens: counts.littleArdiaPinchOpens,
      little_ardia_pinch_closes: counts.littleArdiaPinchCloses,
      auto_hide_tabs_toggles: counts.autoHideTabsToggles,
      windows_realigned_to_auto_hide_tabs: counts.windowsRealignedToAutoHideTabs,
      tab_strip_peeks: counts.tabStripPeeks,
      tab_peeks_with_auto_hide_off: counts.tabPeeksWithAutoHideOff,
      imported_pinned_rows: counts.importedPinnedRows,
      imported_splits: counts.importedSplits,
      split_pane_closes: counts.splitPaneCloses,
      split_view_closes: counts.splitViewCloses,
      window_close_tabs_kept: counts.windowCloseTabsKept,
      sync_snapshots_written: snapshots.count,
      sync_snapshot_kb_written: Math.round(snapshots.bytes / 1024),
      toolbar_scroll_hides: counts.toolbarScrollHides,
      toolbar_scroll_hide_bounces: counts.toolbarScrollHideBounces,
      shares_picked_tab: counts.sharesPickedTab,
      shares_picked_window: counts.sharesPickedWindow,
      shares_picked_screen: counts.sharesPickedScreen,
      share_picker_screen_recording_missing: counts.screenRecordingMissing,
      share_picker_screen_recording_asked: counts.screenRecordingAsked,
      extension_install_prompts: counts.extensionInstallPrompts,
      private_window_extension_opens: counts.privateWindowExtensionOpens,
      period_minutes: Math.round((Date.now() - countsSince) / 60_000),
    });
  }
  counts = { ...NO_COUNTS };
  countsSince = Date.now();
}

export function noteImportedPins(made: { rows: number; splits: number }) {
  counts.importedPinnedRows += made.rows;
  counts.importedSplits += made.splits;
}

export function noteSplitClosed(whole: boolean) {
  if (whole) counts.splitViewCloses++;
  else counts.splitPaneCloses++;
}

export function noteWindowCloseTabsKept(n: number) {
  counts.windowCloseTabsKept += n;
}

export function noteSharePicked(kind: "tab" | "window" | "screen") {
  if (kind === "tab") counts.sharesPickedTab++;
  else if (kind === "window") counts.sharesPickedWindow++;
  else counts.sharesPickedScreen++;
}

export function noteScreenRecordingMissing() {
  counts.screenRecordingMissing++;
}

export function noteScreenRecordingAsked() {
  counts.screenRecordingAsked++;
}

export function noteExtensionInstallPrompt() {
  counts.extensionInstallPrompts++;
}

export function notePrivateWindowExtensionOpen() {
  counts.privateWindowExtensionOpens++;
}

export function noteCaptureIndicatorCleared() {
  counts.captureIndicatorsCleared++;
}

export function noteCliEdits(tabEdits: number, groupEdits: number, failures: number) {
  counts.cliTabEdits += tabEdits;
  counts.cliGroupEdits += groupEdits;
  counts.cliEditFailures += failures;
}

export function noteCliPillShown() {
  counts.cliPillShows++;
}

export function notePopoverClosed(by: "press" | "escape") {
  if (by === "press") counts.popoverPressCloses++;
  else counts.popoverEscapeCloses++;
}

export function noteTabSwitcherOpened(closedLeftOut: number) {
  counts.tabSwitcherOpens++;
  counts.tabSwitcherClosedLeftOut += closedLeftOut;
}

export function noteApprovalNoticeDeferred() {
  counts.approvalNoticesDeferred++;
}

export function noteReopenedPage(canGoBack: boolean) {
  counts.reopenedPages++;
  if (canGoBack) counts.reopenedPagesWithBack++;
}

export function notePinch(on: "peek" | "littleArdia", outcome: "open" | "close") {
  if (on === "peek") counts[outcome === "open" ? "peekPinchOpens" : "peekPinchCloses"]++;
  else counts[outcome === "open" ? "littleArdiaPinchOpens" : "littleArdiaPinchCloses"]++;
}

export function noteGroupHeaderHide() {
  counts.groupHeaderHides++;
}

export function keptTabsAdded(groups: BrowserState["groups"], prev: BrowserState["groups"]): number {
  const added = new Set<string>();
  for (const id in groups) {
    const shown = groups[id]!.shownTabIds;
    if (!shown || shown === prev[id]?.shownTabIds) continue;
    for (const tabId of shown) if (!prev[id]?.shownTabIds?.includes(tabId)) added.add(tabId);
  }
  return added.size;
}

export function noteSidebarPeek(bounce: boolean) {
  counts.sidebarPeeks++;
  if (bounce) counts.sidebarPeekBounces++;
  if (!useBrowser.getState().settings.autoHideTabs) counts.tabPeeksWithAutoHideOff++;
}

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
      for (const id in s.windowUi) if (s.windowUi[id]?.panel.open && !prev.windowUi[id]?.panel.open) capture("command_bar_opened");
    }
  });
}

const TOOLBAR_BOUNCE_MS = 1000;

function watchToolbarAutoHide() {
  const shownAt = new Map<string, number>();
  useToolbarAutoHide.subscribe((s, prev) => {
    if (s.scrolledDown === prev.scrolledDown) return;
    const now = Date.now();
    for (const id in prev.scrolledDown) if (!s.scrolledDown[id]) shownAt.set(id, now);
    for (const id in s.scrolledDown) {
      if (prev.scrolledDown[id]) continue;
      counts.toolbarScrollHides++;
      const shown = shownAt.get(id);
      if (shown !== undefined && now - shown < TOOLBAR_BOUNCE_MS) counts.toolbarScrollHideBounces++;
      shownAt.delete(id);
    }
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
  capture("perf_omnibox", { samples: samples.length, p50_ms: at(0.5), p95_ms: at(0.95), max_ms: samples.at(-1)! });
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
