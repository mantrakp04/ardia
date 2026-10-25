import { listTasks, onSystemState, releaseProfile, setBatterySaver, systemState, type SystemState, type WebViewHandle } from "@ardia/ardiacore";
import { onAppEvent, onWindowEvent } from "@ardia/shell";
import { create } from "zustand";
import { pageOf, usePages } from "../components/layout/pageState";
import { showToast } from "../components/layout/splitActions";
import { useMedia } from "../components/media/state";
import { isInternalTab } from "../components/pages";
import { openSettings } from "../components/settings/windows";
import { useBrowser, type BrowserState } from "../store/browser";
import type { BatterySaverWhen } from "../store/settings";
import { activeTabId, engineProfile, isIncognitoProfile, wake } from "../store/model";
import { peekTabId } from "../store/peek";
import { holderOf } from "../store/pinShare";
import { splitOf } from "../store/splits";
import { switchOn } from "./killSwitches";
import { applyHeldReports } from "./nativeEvents";
import { everySlowly, reschedule } from "./slowTimers";
import { webviews } from "./webviews";

const POLICY = {
  protectedRecent: 10,
  idleMs: 30 * 60_000,
  profileIdleMs: 10 * 60_000,
  perSweep: 6,
  busyCpu: 10,
  freezeAfterMs: 60_000,
};

const SWEEP_MS = 30_000;
const FREEZE_SWEEP_MS = 30_000;
const EVAL_TIMEOUT_MS = 2_000;

type Lifecycle = {
  discarded: Record<string, true>;
  batterySaver: boolean;
};

export const useLifecycle = create<Lifecycle>()(() => ({ discarded: {}, batterySaver: false }));

export const useIsSleeping = (tabId: string) => useLifecycle((l) => !!l.discarded[tabId]);

const store = () => useBrowser.getState();

let appActive = true;
let activeSince = Date.now();
let activeTotal = 0;
const activeClock = () => activeTotal + (appActive ? Date.now() - activeSince : 0);
function setAppActive(active: boolean) {
  if (active === appActive) return;
  if (appActive) activeTotal += Date.now() - activeSince;
  else activeSince = Date.now();
  appActive = active;
}

const hiddenAt = new Map<string, number>();
const unusedSince = new Map<string, number>();
const loadedProfiles = new Set<string>();
const busyStreak = new Map<string, number>();

let system: SystemState | null = null;
let systemOverride: Partial<SystemState> | null = null;
const currentSystem = () => (system ? { ...system, ...systemOverride } : null);

function shownTabIds(s: BrowserState): Set<string> {
  const shown = new Set<string>();
  for (const w of Object.values(s.windows)) {
    const id = activeTabId(s, w.id);
    if (!id) continue;
    shown.add(id);
    const peek = peekTabId(s, w.id);
    if (peek) shown.add(peek);
    const held = s.tabs[id]?.pageIn;
    if (held) shown.add(held);
    for (const pane of splitOf(s, id)?.tabIds ?? []) shown.add(pane);
  }
  return shown;
}

const loadedTabIds = () => [...webviews.keys()].filter((id) => !useLifecycle.getState().discarded[id]);

function keepAliveReason(s: BrowserState, id: string): string | null {
  const tab = s.tabs[id];
  if (!tab?.url || isInternalTab(tab)) return "no page";
  const live = s.live[id];
  if (live?.playingAudio) return "playing audio";
  if (live?.isLoading) return "loading";
  const page = pageOf(id);
  if (page.mediaAccess) return "capturing";
  if (page.permission) return "asking for permission";
  if (page.newTabShown) return "kept for Forward";
  const media = useMedia.getState();
  if (media.pipOpen[id]) return "picture in picture";
  if (media.displayRequests[id]) return "choosing a screen to share";
  const session = media.sessions[id];
  if (session?.playbackState === "playing" || (tab.pinned && session)) return "media";
  if (splitOf(s, id)) return "in a split";
  return null;
}

const UNSAVED_INPUT_CHECK = `
const notText = new Set(["hidden", "submit", "button", "reset", "image", "search", "checkbox", "radio", "range", "color"]);
const dirty = (doc) => {
  for (const el of doc.querySelectorAll("input, textarea")) {
    if (el.disabled || el.readOnly) continue;
    if (el.type === "file") {
      if (el.files && el.files.length) return true;
    } else if (!notText.has(el.type) && el.value && el.value !== el.defaultValue) {
      return true;
    }
  }
  const active = doc.activeElement;
  return !!(active && active.isContentEditable && active.textContent.trim());
};
let unsaved = typeof window.onbeforeunload === "function" || dirty(document);
for (let i = 0; !unsaved && i < frames.length; i++) {
  try { unsaved = typeof frames[i].onbeforeunload === "function" || dirty(frames[i].document); } catch (e) {}
}
post("result", JSON.stringify(unsaved));`;

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

async function hasUnsavedInput(handle: WebViewHandle): Promise<boolean | null> {
  const result = await withTimeout(handle.evaluate<boolean>(UNSAVED_INPUT_CHECK).catch(() => null), EVAL_TIMEOUT_MS, null);
  return typeof result === "boolean" ? result : null;
}

export async function sleepTab(id: string): Promise<boolean> {
  const handle = webviews.get(id);
  if (!handle || useLifecycle.getState().discarded[id]) return false;
  if ((await hasUnsavedInput(handle)) !== false) return false;
  applyHeldReports();
  const s = store();
  if (shownTabIds(s).has(id) || keepAliveReason(s, id) || webviews.get(id) !== handle) return false;
  return (await handle.discard()) === "discarded";
}

export function noteReady(tabId: string) {
  const tab = store().tabs[tabId];
  if (tab) loadedProfiles.add(engineProfile(tab.profileId));
  forget(tabId, false);
}

export function noteDiscarded(tabId: string) {
  useLifecycle.setState((l) => ({ discarded: { ...l.discarded, [tabId]: true } }));
}

export function noteGone(tabId: string) {
  forget(tabId, true);
}

function forget(tabId: string, all: boolean) {
  busyStreak.delete(tabId);
  if (all) hiddenAt.delete(tabId);
  const l = useLifecycle.getState();
  if (l.discarded[tabId]) useLifecycle.setState({ discarded: omit(l.discarded, tabId) });
}

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

let sweeping = false;

export async function sweep(overrides: Partial<typeof POLICY> = {}): Promise<string[]> {
  if (sweeping) return [];
  sweeping = true;
  const slept: string[] = [];
  try {
    const policy = { ...POLICY, ...overrides };
    const s = store();
    const shown = shownTabIds(s);
    const now = activeClock();
    const pressure = currentSystem()?.memoryPressure ?? "normal";
    const recent = new Set(
      Object.values(s.tabs)
        .filter((t) => t.url)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, pressure === "critical" ? 0 : policy.protectedRecent)
        .map((t) => t.id),
    );
    const unused = unusedProfiles(s, now, policy.profileIdleMs);
    const candidates = [...webviews.keys()].filter((id) => {
      const tab = s.tabs[id];
      if (!tab || shown.has(id) || useLifecycle.getState().discarded[id]) return false;
      const idle = now - (hiddenAt.get(id) ?? now);
      if (!unused.has(tab.profileId) && (recent.has(id) || (pressure === "normal" && idle < policy.idleMs))) return false;
      return !keepAliveReason(s, id);
    });
    candidates.sort((a, b) => (hiddenAt.get(a) ?? now) - (hiddenAt.get(b) ?? now));
    for (const id of candidates) {
      if (slept.length >= policy.perSweep) break;
      if (await sleepTab(id)) slept.push(id);
    }
    releaseUnusedProfiles();
  } finally {
    sweeping = false;
  }
  return slept;
}

function unusedProfiles(s: BrowserState, now: number, idleMs: number): Set<string> {
  const shownProfiles = new Set(Object.values(s.windows).map((w) => w.profileId));
  const unused = new Set<string>();
  for (const id of Object.keys(s.profiles)) {
    if (shownProfiles.has(id)) {
      unusedSince.delete(id);
      continue;
    }
    if (!unusedSince.has(id)) unusedSince.set(id, now);
    if (now - unusedSince.get(id)! >= idleMs) unused.add(id);
  }
  for (const id of unusedSince.keys()) if (!s.profiles[id]) unusedSince.delete(id);
  return unused;
}

function releaseUnusedProfiles() {
  const s = store();
  const inUse = new Set(Object.values(s.windows).map((w) => engineProfile(w.profileId)));
  for (const id of webviews.keys()) {
    const tab = s.tabs[id];
    if (tab) inUse.add(engineProfile(tab.profileId));
  }
  for (const profile of [...loadedProfiles]) {
    if (!profile || isIncognitoProfile(profile) || inUse.has(profile)) continue;
    loadedProfiles.delete(profile);
    void releaseProfile(profile);
  }
}

const CHROME_SAVER_STATE = { off: 0, on: 3 } as const;

let chromeSaver = false;
let chromeSaverSync = 0;

export async function syncChromeBatterySaver(): Promise<boolean> {
  const mode = switchOn("chromeBatterySaver") ? (useLifecycle.getState().batterySaver ? "on" : "off") : "default";
  const sync = ++chromeSaverSync;
  const owned = await setBatterySaver(mode).then(
    (reply) => mode !== "default" && reply.state === CHROME_SAVER_STATE[mode],
    () => false,
  );
  if (sync === chromeSaverSync) chromeSaver = owned;
  reschedule();
  return chromeSaver;
}

const LOW_BATTERY_PERCENT = 20;

export function batterySaverWanted(when: BatterySaverWhen, sys: SystemState | null, lowBatteryHeld = false): { on: boolean; lowBatteryHeld: boolean } {
  if (when === "never" || !sys) return { on: false, lowBatteryHeld: false };
  const low = when === "lowBattery" && sys.onBattery && (lowBatteryHeld || (sys.batteryLevel !== null && Math.round(sys.batteryLevel * 100) <= LOW_BATTERY_PERCENT));
  return { on: sys.lowPowerMode || (sys.onBattery && when === "unplugged") || low, lowBatteryHeld: low };
}

let lowBatteryHeld = false;

function updateBatterySaver(announce: boolean) {
  const wanted = batterySaverWanted(store().settings.batterySaverWhen, currentSystem(), lowBatteryHeld);
  lowBatteryHeld = wanted.lowBatteryHeld;
  const on = wanted.on;
  if (on === useLifecycle.getState().batterySaver) return;
  useLifecycle.setState({ batterySaver: on });
  void syncChromeBatterySaver();
  if (!on && !chromeSaver) thawAll();
  const windowId = store().ui.focusedWindowId;
  if (!announce || !windowId || !store().windows[windowId]) return;
  if (on) {
    showToast(windowId, "Battery Saver Mode Activated", "Busy background tabs are paused.", {
      icon: "battery.25",
      action: { title: "Settings", run: () => openSettings("advanced") },
    });
  } else {
    showToast(windowId, "Battery Saver Mode Deactivated", undefined, { icon: "battery.100.bolt" });
  }
}

function thawAll() {
  const shown = shownTabIds(store());
  for (const id of loadedTabIds()) if (!shown.has(id)) void webviews.get(id)?.setFrozen(false);
  busyStreak.clear();
}

let freezing = false;

async function freezeBusyTabs(overrides: Partial<typeof POLICY> = {}): Promise<string[]> {
  if (freezing) return [];
  freezing = true;
  const frozen: string[] = [];
  try {
    const policy = { ...POLICY, ...overrides };
    await listTasks();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const tasks = await listTasks();
    const s = store();
    const shown = shownTabIds(s);
    const browsers = usePages.getState().browsers;
    const cpu = new Map<string, number>();
    for (const task of tasks) {
      if (task.cpu < 0 || task.browserIds.some((b) => shown.has(browsers[b] ?? ""))) continue;
      for (const b of task.browserIds) {
        const tabId = browsers[b];
        if (tabId) cpu.set(tabId, Math.max(cpu.get(tabId) ?? 0, task.cpu));
      }
    }
    const now = activeClock();
    for (const id of loadedTabIds()) {
      if (shown.has(id)) continue;
      const streak = (cpu.get(id) ?? 0) >= policy.busyCpu ? (busyStreak.get(id) ?? 0) + 1 : 0;
      busyStreak.set(id, streak);
      if (streak < 2 || now - (hiddenAt.get(id) ?? now) < policy.freezeAfterMs || keepAliveReason(s, id)) continue;
      if (await freezeTab(id)) frozen.push(id);
    }
  } finally {
    freezing = false;
  }
  return frozen;
}

export async function freezeTab(id: string): Promise<boolean> {
  const handle = webviews.get(id);
  if (!handle || !useLifecycle.getState().batterySaver) return false;
  applyHeldReports();
  const s = store();
  if (shownTabIds(s).has(id) || keepAliveReason(s, id)) return false;
  await handle.setFrozen(true);
  return true;
}

export function reloadRecentTabs(sys: SystemState) {
  const gb = sys.physicalMemory / 2 ** 30;
  const busy = sys.onBattery || sys.lowPowerMode || sys.memoryPressure !== "normal";
  const count = busy ? 0 : gb >= 32 ? 4 : gb >= 16 ? 3 : gb >= 8 ? 1 : 0;
  const s = store();
  const shown = shownTabIds(s);
  const since = Date.now() - 24 * 60 * 60_000;
  const ids = Object.values(s.tabs)
    .filter((t) => t.url && !t.navigation && !t.adoptId && !t.unloaded && !t.pageIn && !shown.has(t.id) && !isInternalTab(t) && t.lastActiveAt >= since)
    .filter((t) => s.windows[t.windowId]?.profileId === t.profileId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, count)
    .map((t) => t.id);
  ids.forEach((id, i) =>
    setTimeout(() => {
      const now = store();
      const t = now.tabs[id];
      if (t?.url && !t.navigation && !t.adoptId && !t.unloaded && !t.pageIn && !holderOf(now, id)) now.updateTab(id, wake(t));
    }, 2000 * (i + 1)),
  );
  return ids;
}

let started = false;

export function startTabLifecycle() {
  if (started) return;
  started = true;

  onWindowEvent((e) => e.type === "focus" && setAppActive(true));
  onAppEvent((e) => (e.type === "resignActive" || e.type === "screenLocked") && setAppActive(false));

  let lastShown = new Set<string>();
  const track = (s: BrowserState) => {
    const shown = shownTabIds(s);
    const now = activeClock();
    for (const id of lastShown) if (!shown.has(id)) hiddenAt.set(id, now);
    for (const id of shown) {
      hiddenAt.delete(id);
      busyStreak.delete(id);
    }
    for (const id of webviews.keys()) if (!shown.has(id) && !hiddenAt.has(id)) hiddenAt.set(id, now);
    lastShown = shown;
  };
  track(store());
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || s.splits !== prev.splits) track(s);
    if (s.settings.batterySaverWhen !== prev.settings.batterySaverWhen) {
      lowBatteryHeld = false;
      updateBatterySaver(false);
    }
  });

  const onSystem = (state: SystemState) => {
    const pressureRose = state.memoryPressure !== "normal" && state.memoryPressure !== system?.memoryPressure;
    system = state;
    updateBatterySaver(true);
    if (pressureRose) void sweep();
  };
  void Promise.resolve()
    .then(systemState)
    .then(
      (state) => {
        system = state;
        updateBatterySaver(false);
        void syncChromeBatterySaver();
        onSystemState(onSystem);
        setTimeout(() => reloadRecentTabs(currentSystem()!), 3000);
      },
      () => {},
    );

  everySlowly({
    every: SWEEP_MS,
    separateEvery: 15_000,
    run: () => {
      track(store());
      void sweep();
    },
  });
  everySlowly({
    every: FREEZE_SWEEP_MS,
    run: () => void freezeBusyTabs(),
    needed: () => useLifecycle.getState().batterySaver && !chromeSaver,
    watch: (changed) => useLifecycle.subscribe(changed),
  });

  if (__DEV__) {
    (globalThis as { acLifecycle?: unknown }).acLifecycle = {
      policy: POLICY,
      sweep,
      sleepTab,
      freezeBusyTabs,
      freezeTab,
      reloadRecentTabs,
      state: () => ({
        ...useLifecycle.getState(),
        system: currentSystem(),
        appActive,
        activeClock: activeClock(),
        hiddenAt: Object.fromEntries(hiddenAt),
        loadedProfiles: [...loadedProfiles],
        loaded: loadedTabIds(),
        chromeSaver,
      }),
      keepAliveReason: (id: string) => keepAliveReason(store(), id),
      memory: () =>
        listTasks()
          .then(() => new Promise((resolve) => setTimeout(resolve, 2500)))
          .then(listTasks)
          .then((tasks) => {
            const byType: Record<string, number> = {};
            const seen = new Set<string>();
            for (const t of tasks) {
              const key = t.browserIds.length ? `${t.type}:${t.memory}` : `${t.id}`;
              if (t.memory < 0 || seen.has(key)) continue;
              seen.add(key);
              byType[t.type] = (byType[t.type] ?? 0) + t.memory / 2 ** 20;
            }
            const total = Object.values(byType).reduce((a, b) => a + b, 0);
            return { totalMB: Math.round(total), byTypeMB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)])), tasks: tasks.length };
          }),
      simulate: (patch: Partial<SystemState> | null) => {
        systemOverride = patch;
        updateBatterySaver(true);
      },
    };
  }
}
