import { onSystemState, setBatterySaver, systemState, type SystemState } from "../../platform/performance";
import { releaseProfile } from "../../platform/profiles";
import { showToast } from "../app/toasts";
import { openSettings } from "../settings/settingsWindows";
import { useBrowser, type BrowserState } from "../browser/store";
import type { BatterySaverWhen } from "../settings/settings";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { reloadRecentTabs } from "./recentTabWarmup";
import { everySlowly } from "../../platform/slowTimers";
import { webviews } from "../../platform/webviews";
import { useLifecycle } from "./sleepingTabs";
import { startMemorySaver } from "./memorySaver";
import { focusedWindowOf } from "../windows/ui";

export { useIsSleeping, useLifecycle } from "./sleepingTabs";

const RELEASE_PROFILES_MS = 60_000;

const store = () => useBrowser.getState();

const loadedProfiles = new Set<string>();

let system: SystemState | null = null;
let systemOverride: Partial<SystemState> | null = null;
const currentSystem = () => (system ? { ...system, ...systemOverride } : null);

export function noteReady(tabId: string) {
  const tab = store().tabs[tabId];
  if (tab) loadedProfiles.add(engineProfile(useBrowser.getState(), tab.profileId));
  forget(tabId);
}

export function noteDiscarded(tabId: string) {
  useLifecycle.setState((l) => ({ discarded: { ...l.discarded, [tabId]: true } }));
}

export function noteGone(tabId: string) {
  forget(tabId);
}

function forget(tabId: string) {
  const l = useLifecycle.getState();
  if (!l.discarded[tabId]) return;
  const discarded = { ...l.discarded };
  delete discarded[tabId];
  useLifecycle.setState({ discarded });
}

function releaseUnusedProfiles() {
  const s = store();
  const inUse = new Set(Object.values(s.windows).map((w) => engineProfile(s, w.profileId)));
  for (const id of webviews.keys()) {
    const tab = s.tabs[id];
    if (tab) inUse.add(engineProfile(s, tab.profileId));
  }
  for (const profile of [...loadedProfiles]) {
    if (!profile || isIncognitoProfile(profile) || inUse.has(profile)) continue;
    loadedProfiles.delete(profile);
    void releaseProfile(profile);
  }
}

function syncBatterySaver() {
  void setBatterySaver(useLifecycle.getState().batterySaver ? "on" : "off").catch(() => {});
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
  syncBatterySaver();
  const windowId = focusedWindowOf(store());
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

let started = false;

export function startTabLifecycle() {
  if (started) return;
  started = true;

  startMemorySaver();
  useBrowser.subscribe((s: BrowserState, prev: BrowserState) => {
    if (s.settings.batterySaverWhen !== prev.settings.batterySaverWhen) {
      lowBatteryHeld = false;
      updateBatterySaver(false);
    }
  });

  void Promise.resolve()
    .then(systemState)
    .then(
      (state) => {
        system = state;
        updateBatterySaver(false);
        syncBatterySaver();
        onSystemState((next) => {
          system = next;
          updateBatterySaver(true);
        });
        setTimeout(() => {
          const sys = currentSystem();
          if (sys) reloadRecentTabs(sys);
        }, 3000);
      },
      () => {},
    );

  everySlowly({ every: RELEASE_PROFILES_MS, run: releaseUnusedProfiles });

  if (__DEV__) {
    (globalThis as { acLifecycle?: unknown }).acLifecycle = {
      reloadRecentTabs,
      releaseUnusedProfiles,
      state: () => ({
        ...useLifecycle.getState(),
        system: currentSystem(),
        loadedProfiles: [...loadedProfiles],
        loaded: [...webviews.keys()].filter((id) => !useLifecycle.getState().discarded[id]),
      }),
      simulate: (patch: Partial<SystemState> | null) => {
        systemOverride = patch;
        updateBatterySaver(true);
      },
    };
  }
}
