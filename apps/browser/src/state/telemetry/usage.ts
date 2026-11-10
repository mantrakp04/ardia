import { listTasks, type EngineTask } from "../../platform/performance";
import { onExtensionsChanged } from "../../platform/extensions";
import { currentAppIcon, onAppEvent } from "../../platform/app";
import { useTranslate } from "../site/translate";
import { useBrowser } from "../browser/store";
import { useSync } from "../sync/engine";
import { capture, endSession, flush, isSharing, markSettingsSnapshot, settingsSnapshotDay, startClient } from "./client";
import { reportLocalStore, startLocalStore } from "./localStoreReport";
import { startWatchChecks } from "./watch";
import { appIconSetting, SETTINGS_SNAPSHOT_EVENT, settingsSnapshot } from "./settingsSnapshot";
import { utcDay } from "./daily";
import { appInfo, percentile } from "./transport";
import { reportNativeCrashes } from "./errors";
import { emitJourneys, journeysEnding, startJourneys } from "./journeys";
import { takeOmniboxLatency } from "./track";
import { contextProperties, contextSamples, hardwareProperties, noteAppMemory, recordContext, startContextSamples, stopContextSamples } from "./diagnostics";
import { emitTabPresses } from "./tabPresses";
import { switcherSwitchProperties } from "./switcherPresses";
import { watchPasteRefused } from "./pasteRefused";
import type { SavedContext } from "./savedContext";
import { splitTabIds } from "../splits/splits";

const HOUR_MS = 60 * 60_000;
const FIRST_MEMORY_SAMPLE_MS = 10 * 60_000;
const FIRST_SETTINGS_SNAPSHOT_MS = 2 * 60_000;
const EXTENSION_SETTLE_MS = 20_000;
const LOCAL_STORE_LAUNCH_DELAY_MS = 20_000;

const startedAt = Date.now();
const NO_COUNTS = { tabs: 0, windows: 0, captureIndicatorsCleared: 0, fullScreens: 0, sidebarPeeks: 0, sidebarPeekBounces: 0, cliTabEdits: 0, cliGroupEdits: 0, cliEditFailures: 0, popoverPressCloses: 0, popoverEscapeCloses: 0, tabSwitcherOpens: 0, tabSwitcherClosedLeftOut: 0 };
let counts = { ...NO_COUNTS };
let countsSince = Date.now();

function emitCounts() {
  if (Object.values(counts).some(Boolean)) {
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
      popover_press_closes: counts.popoverPressCloses,
      popover_escape_closes: counts.popoverEscapeCloses,
      tab_switcher_opens: counts.tabSwitcherOpens,
      tab_switcher_closed_left_out: counts.tabSwitcherClosedLeftOut,
      period_minutes: Math.round((Date.now() - countsSince) / 60_000),
    });
  }
  counts = { ...NO_COUNTS };
  countsSince = Date.now();
}

export function noteCaptureIndicatorCleared() {
  counts.captureIndicatorsCleared++;
}

export function noteCliEdits(tabEdits: number, groupEdits: number, failures: number) {
  counts.cliTabEdits += tabEdits;
  counts.cliGroupEdits += groupEdits;
  counts.cliEditFailures += failures;
}

export function notePopoverClosed(by: "press" | "escape") {
  if (by === "press") counts.popoverPressCloses++;
  else counts.popoverEscapeCloses++;
}

export function noteTabSwitcherOpened(closedLeftOut: number) {
  counts.tabSwitcherOpens++;
  counts.tabSwitcherClosedLeftOut += closedLeftOut;
}

export function noteSidebarPeek(bounce: boolean) {
  counts.sidebarPeeks++;
  if (bounce) counts.sidebarPeekBounces++;
}

const size = (o: object) => Object.keys(o).length;

function watchStore() {
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs) counts.tabs += Math.max(0, size(s.tabs) - size(prev.tabs));
    if (s.windows !== prev.windows) {
      counts.windows += Math.max(0, size(s.windows) - size(prev.windows));
      for (const id in s.windows) {
        const w = s.windows[id]!;
        const before = prev.windows[id];
        if (before && !before.fullScreen && w.fullScreen) counts.fullScreens++;
        if (before && before.profileId !== w.profileId && w.kind !== "private") profileSwitched(size(s.profiles), switcherSwitchProperties(id, w.profileId));
      }
    }
    if (s.splits !== prev.splits) {
      for (const id in s.splits) if (!prev.splits[id]) capture("split_view_opened", { panes: splitTabIds(s.splits[id]!).length });
    }
    if (s.windowUi !== prev.windowUi) {
      for (const id in s.windowUi) if (s.windowUi[id]?.panel.open && !prev.windowUi[id]?.panel.open) capture("command_bar_opened");
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
  const settings = settingsSnapshot(useBrowser.getState().settings);
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
  watchStore();
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
  watchPasteRefused();
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
