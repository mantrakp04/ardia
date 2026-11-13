import { onSystemState, setBatterySaver, systemState, type SystemState } from "../../platform/performance";
import { profileSelected, suspendProfilePages } from "../profiles/suspendProfile";
import { idleProfiles, profileUnloadDelay } from "../profiles/idleProfiles";
import { releaseProfile, loadedProfiles as nativeLoadedProfiles } from "../../platform/profiles";
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
import { noteTabSlept } from "../telemetry/tabSleepCounts";
import { unloadProfile } from "../profiles/profileLoading";

export { useIsSleeping, useLifecycle } from "./sleepingTabs";

const RELEASE_PROFILES_MS = 60_000;

const store = () => useBrowser.getState();

const loadedProfiles = new Set<string>();
const profileGenerations = new Map<string, number>();
const readyToRelease = idleProfiles();
const releasingProfiles = new Set<string>();
let readingProfiles = false;

let system: SystemState | null = null;
let systemOverride: Partial<SystemState> | null = null;
const currentSystem = () => (system ? { ...system, ...systemOverride } : null);

export function noteReady(tabId: string) {
  const tab = store().tabs[tabId];
  if (tab) {
    const profile = engineProfile(useBrowser.getState(), tab.profileId);
    loadedProfiles.add(profile);
    profileGenerations.set(profile, (profileGenerations.get(profile) ?? 0) + 1);
  }
  forget(tabId);
}

export function noteDiscarded(tabId: string, reason: string | null = null) {
  noteTabSlept(!!store().tabs[tabId]?.pin, reason);
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
  for (const profile of readyToRelease(loadedProfiles, inUse, Date.now(), profileUnloadDelay(s.settings))) {
    if (isIncognitoProfile(profile) || releasingProfiles.has(profile)) continue;
    releasingProfiles.add(profile);
    const generation = profileGenerations.get(profile);
    const unloadAfter = s.settings.unloadProfilesAfter;
    void suspendProfilePages(profile, { state: store, handles: webviews }).then((suspended) =>
      suspended && store().settings.unloadProfilesAfter === unloadAfter
        && profileUnloadDelay(store().settings) !== null && !profileSelected(store(), profile) ? releaseProfile(profile) : null,
    ).then((result) => {
      if (result?.status === "released" && profileGenerations.get(profile) === generation) {
        loadedProfiles.delete(profile);
        unloadProfile(profile);
      }
    }).catch(() => {}).finally(() => releasingProfiles.delete(profile));
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
    if (s.windows !== prev.windows || s.profiles !== prev.profiles
      || s.settings.memorySaver !== prev.settings.memorySaver
      || s.settings.unloadProfilesAfter !== prev.settings.unloadProfilesAfter) releaseUnusedProfiles();
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

  const pollProfiles = () => {
    if (readingProfiles) return;
    readingProfiles = true;
    void nativeLoadedProfiles().then((profiles) => {
      for (const profile of profiles) if (!isIncognitoProfile(profile)) loadedProfiles.add(profile);
      releaseUnusedProfiles();
    }).catch(() => {}).finally(() => { readingProfiles = false; });
  };
  pollProfiles();
  everySlowly({ every: RELEASE_PROFILES_MS, run: pollProfiles });

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
