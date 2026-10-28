import { listTasks, onSystemState, setBatterySaver, systemState, type EngineTask, type SystemState } from "../../platform/performance";
import { releaseProfile } from "../../platform/profiles";
import { isTabReady } from "./pageState";
import { showToast } from "../splits/actions";
import { hasUnsavedInput, keepAliveReason, shownTabIds } from "./tabKeepAlive";
import { openSettings } from "../settings/settingsWindows";
import { useBrowser, type BrowserState } from "../browser/store";
import type { BatterySaverWhen } from "../settings/settings";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { reloadRecentTabs } from "./recentTabWarmup";
import { switchOn } from "../../platform/killSwitches";
import { applyHeldReports } from "../../platform/nativeEvents";
import { everySlowly, reschedule } from "../../platform/slowTimers";
import { webviews } from "../../platform/webviews";
import { useLifecycle } from "./sleepingTabs";
import { awakeClock, sleepAfterMs, SLEEP_POLICY } from "./sleepPolicy";

export { useIsSleeping, useLifecycle } from "./sleepingTabs";

const POLICY = SLEEP_POLICY;

const SWEEP_MS = 30_000;
const FREEZE_SWEEP_MS = 30_000;

const store = () => useBrowser.getState();

const clock = awakeClock(() => Date.now(), POLICY.maxAwakeStepMs);
const awakeNow = () => clock.read();

const hiddenAt = new Map<string, number>();
const unusedSince = new Map<string, number>();
const loadedProfiles = new Set<string>();
const busyStreak = new Map<string, number>();

let system: SystemState | null = null;
let systemOverride: Partial<SystemState> | null = null;
const currentSystem = () => (system ? { ...system, ...systemOverride } : null);

const loadedTabIds = () => [...webviews.keys()].filter((id) => !useLifecycle.getState().discarded[id]);

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
  if (useLifecycle.getState().discarded[tabId] && hiddenAt.has(tabId)) hiddenAt.set(tabId, awakeNow());
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
    const now = awakeNow();
    const pressure = currentSystem()?.memoryPressure ?? "normal";
    const unused = unusedProfiles(s, now, policy.profileIdleMs);
    const hidden = loadedTabIds().filter((id) => s.tabs[id] && !shown.has(id));
    const inUnusedProfile = (id: string) => unused.has(s.tabs[id]!.profileId);
    const recent = new Set(
      hidden
        .filter((id) => s.tabs[id]!.url && !inUnusedProfile(id))
        .sort((a, b) => s.tabs[b]!.lastActiveAt - s.tabs[a]!.lastActiveAt)
        .slice(0, policy.protectedRecent),
    );
    const hiddenFor = (id: string) => now - (hiddenAt.get(id) ?? now);
    const restedEnough = (id: string) => hiddenFor(id) >= sleepAfterMs(policy, pressure, recent.has(id));
    const candidates = hidden.filter((id) => restedEnough(id) && !keepAliveReason(s, id));
    candidates.sort((a, b) => Number(inUnusedProfile(b)) - Number(inUnusedProfile(a)) || hiddenFor(b) - hiddenFor(a));
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
    await listTasks().catch((): EngineTask[] => []);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const tasks = await listTasks().catch((): EngineTask[] => []);
    const s = store();
    const shown = shownTabIds(s);
    const cpu = new Map<string, number>();
    for (const task of tasks) {
      if (task.cpu < 0 || task.tabIds.some((t) => !!t && isTabReady(t) && shown.has(t))) continue;
      for (const tabId of task.tabIds) {
        if (tabId && isTabReady(tabId)) cpu.set(tabId, Math.max(cpu.get(tabId) ?? 0, task.cpu));
      }
    }
    const now = awakeNow();
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

let started = false;

export function startTabLifecycle() {
  if (started) return;
  started = true;

  let lastShown = new Set<string>();
  const track = (s: BrowserState) => {
    const shown = shownTabIds(s);
    const now = awakeNow();
    const hide = (id: string) => hiddenAt.set(id, now);
    for (const id of lastShown) if (!shown.has(id)) hide(id);
    for (const id of shown) {
      hiddenAt.delete(id);
      busyStreak.delete(id);
    }
    for (const id of webviews.keys()) if (!shown.has(id) && !hiddenAt.has(id)) hide(id);
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
      advance: (ms: number) => clock.advance(ms),
      state: () => ({
        ...useLifecycle.getState(),
        system: currentSystem(),
        awakeClock: awakeNow(),
        hiddenAt: Object.fromEntries(hiddenAt),
        loadedProfiles: [...loadedProfiles],
        loaded: loadedTabIds(),
        chromeSaver,
      }),
      keepAliveReason: async (id: string) => keepAliveReason(store(), id) ?? ((await hasUnsavedInput(webviews.get(id)!).catch(() => null)) ? "unsaved input" : null),
      memory: () =>
        listTasks()
          .catch((): EngineTask[] => [])
          .then(() => new Promise((resolve) => setTimeout(resolve, 2500)))
          .then(() => listTasks().catch((): EngineTask[] => []))
          .then((tasks) => {
            const byType: Record<string, number> = {};
            const seen = new Set<string>();
            for (const t of tasks) {
              const key = t.tabIds.length ? `${t.type}:${t.memory}` : `${t.id}`;
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
