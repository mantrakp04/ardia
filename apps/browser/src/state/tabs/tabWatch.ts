import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useBrowser, type BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";

type Readable<S> = { getState(): S; subscribe(listener: (s: S, prev: S) => void): () => void };

const subscribeOf = <S,>(store: Readable<S>): Readable<S>["subscribe"] => (store.subscribe as { unprobed?: Readable<S>["subscribe"] }).unprobed ?? store.subscribe;

const watchers = new Map<string, Set<() => void>>();
let listening = false;

function wake(s: BrowserState, prev: BrowserState) {
  if (s.tabs === prev.tabs) return;
  for (const [id, listeners] of watchers) {
    if (s.tabs[id] === prev.tabs[id]) continue;
    for (const listener of [...listeners]) listener();
  }
}

export function watchTab(tabId: string, listener: () => void): () => void {
  if (!listening) {
    listening = true;
    subscribeOf(useBrowser)(wake);
  }
  let listeners = watchers.get(tabId);
  if (!listeners) watchers.set(tabId, (listeners = new Set()));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && watchers.get(tabId) === listeners) watchers.delete(tabId);
  };
}

export const watchedTabs = () => watchers.size;

export function tabSnapshot<T>(tabId: string, select: (tab: Tab | undefined) => T, equal: (a: T, b: T) => boolean = Object.is): () => T {
  let seen: { tab: Tab | undefined; value: T } | null = null;
  return () => {
    const tab = useBrowser.getState().tabs[tabId];
    if (seen && seen.tab === tab) return seen.value;
    const value = select(tab);
    seen = { tab, value: seen && equal(seen.value, value) ? seen.value : value };
    return seen.value;
  };
}

export function useTabValue<T>(tabId: string, select: (tab: Tab | undefined) => T, equal?: (a: T, b: T) => boolean): T {
  const [subscribe, get] = useMemo(() => [(listener: () => void) => watchTab(tabId, listener), tabSnapshot(tabId, select, equal)] as const, [tabId]);
  return useSyncExternalStore(subscribe, get);
}

const inert = Object.assign((_: () => void) => () => {}, { inert: true });

const profileWatchers = new Set<() => void>();
let watchingProfiles = false;

function watchProfiles(listener: () => void): () => void {
  if (!watchingProfiles) {
    watchingProfiles = true;
    subscribeOf(useBrowser)((s, prev) => {
      if (s.profiles !== prev.profiles) for (const l of [...profileWatchers]) l();
    });
  }
  profileWatchers.add(listener);
  return () => profileWatchers.delete(listener);
}

export function useProfilesValue<T>(key: string, select: (profiles: BrowserState["profiles"]) => T): T {
  const read = () => select(useBrowser.getState().profiles);
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    return watchProfiles(() => setValue(read()));
  }, [key]);
  return value;
}

const lookWatchers = new Set<() => void>();
let watchingLooks = false;

function watchLooks(listener: () => void): () => void {
  if (!watchingLooks) {
    watchingLooks = true;
    subscribeOf(useBrowser)((s, prev) => {
      if (s.profiles !== prev.profiles || s.ui.appDark !== prev.ui.appDark || s.settings !== prev.settings) for (const l of [...lookWatchers]) l();
    });
  }
  lookWatchers.add(listener);
  return () => lookWatchers.delete(listener);
}

type LookInputs = { profile: BrowserState["profiles"][string] | undefined; appDark: boolean; settings: BrowserState["settings"] };

type Look<T> = (profile: LookInputs["profile"], appDark: boolean, settings: LookInputs["settings"]) => T;

function lookSnapshot<T>(profileId: string, look: Look<T>): () => T {
  let seen: (LookInputs & { value: T }) | null = null;
  return () => {
    const s = useBrowser.getState();
    const profile = s.profiles[profileId];
    if (seen && seen.profile === profile && seen.appDark === s.ui.appDark && seen.settings === s.settings) return seen.value;
    seen = { profile, appDark: s.ui.appDark, settings: s.settings, value: look(profile, s.ui.appDark, s.settings) };
    return seen.value;
  };
}

export function useLookValue<T>(profileId: string, look: Look<T>): T {
  const get = useMemo(() => lookSnapshot(profileId, look), [profileId]);
  return useSyncExternalStore(watchLooks, get);
}

export function useStoreWhile<S, T>(store: Readable<S>, live: boolean, select: (s: S) => T): T {
  return useSyncExternalStore(live ? subscribeOf(store) : inert, () => select(store.getState()));
}

export const useBrowserWhile = <T,>(live: boolean, select: (s: BrowserState) => T): T => useStoreWhile(useBrowser, live, select);

export const shallowEqual = <T extends Record<string, unknown>>(a: T, b: T) => {
  for (const key in a) if (!Object.is(a[key], b[key])) return false;
  for (const key in b) if (!(key in a)) return false;
  return true;
};
