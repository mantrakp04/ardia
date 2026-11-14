import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { loadedProfiles, onProfileLoaded } from "../../platform/profiles";
import { switchOn } from "../../platform/killSwitches";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile, incognitoOriginal, isIncognitoProfile } from "../browser/model";
import { engineProfiles } from "./engineProfiles";

type ProfileLoading = { deferred: boolean; opened: Readonly<Record<string, true>>; unloaded: Readonly<Record<string, true>> };

export const useProfileLoading = create<ProfileLoading>()(() => ({ deferred: false, opened: {}, unloaded: {} }));
const pendingReleases = new Set<string>();

export const profileOpened = (engine: string, l: ProfileLoading = useProfileLoading.getState()) => !l.unloaded[engine] && (!l.deferred || !!l.opened[engine]);

export const openedEngineProfiles = (s: Pick<BrowserState, "profiles">) => engineProfiles(s).filter((engine) => profileOpened(engine));

export const useOpenedEngines = (engines: readonly string[]): string[] =>
  useProfileLoading(useShallow((l) => engines.filter((engine) => profileOpened(engine, l))));

export const useProfileOpened = (profileId: string): boolean =>
  useProfileLoading((l) => profileOpened(engineProfile(useBrowser.getState(), profileId), l));

export function shownEngineProfiles(s: Pick<BrowserState, "profiles" | "windows">): string[] {
  const shown = new Set<string>();
  for (const w of Object.values(s.windows)) {
    const id = isIncognitoProfile(w.profileId) ? incognitoOriginal(w.profileId) : w.profileId;
    if (s.profiles[id]) shown.add(engineProfile(s, id));
  }
  return [...shown];
}

export function openProfile(engine: string) {
  if (pendingReleases.has(engine)) unloadProfile(engine);
  const l = useProfileLoading.getState();
  if (profileOpened(engine, l)) return;
  const unloaded = { ...l.unloaded };
  delete unloaded[engine];
  useProfileLoading.setState({ opened: { ...l.opened, [engine]: true }, unloaded });
}

export function unloadProfile(engine: string) {
  pendingReleases.delete(engine);
  const l = useProfileLoading.getState();
  if (l.unloaded[engine]) return;
  useProfileLoading.setState({ unloaded: { ...l.unloaded, [engine]: true } });
}

export function noteProfileReleasePending(engine: string, reopened = false) {
  pendingReleases.add(engine);
  if (!reopened) return;
  unloadProfile(engine);
  openProfile(engine);
  pendingReleases.add(engine);
}

export function reconcilePendingProfileReleases(loaded: readonly string[]): string[] {
  const current = new Set(loaded);
  const gone: string[] = [];
  for (const engine of pendingReleases) if (!current.has(engine)) {
    unloadProfile(engine);
    gone.push(engine);
  }
  return gone;
}

export function onProfilesOpened(listener: (engines: string[]) => void): () => void {
  return useProfileLoading.subscribe((l, prev) => {
    if (l.opened === prev.opened && l.deferred === prev.deferred) return;
    const now = engineProfiles(useBrowser.getState()).filter((engine) => profileOpened(engine, l) && !profileOpened(engine, prev));
    if (now.length) listener(now);
  });
}

export function onProfilesUnloaded(listener: (engines: string[]) => void): () => void {
  return useProfileLoading.subscribe((l, prev) => {
    if (l.unloaded === prev.unloaded) return;
    const now = engineProfiles(useBrowser.getState()).filter((engine) => !profileOpened(engine, l) && profileOpened(engine, prev));
    if (now.length) listener(now);
  });
}

export const loadsProfilesWhenOpened = (s: Pick<BrowserState, "settings">) => s.settings.loadProfilesWhenOpened && switchOn("lazyProfiles");

export function startProfileLoading(): () => void {
  const s = useBrowser.getState();
  if (!loadsProfilesWhenOpened(s)) {
    pendingReleases.clear();
    useProfileLoading.setState({ deferred: false, opened: {}, unloaded: {} });
    const loaded = onProfileLoaded(openProfile);
    return () => loaded.remove();
  }
  pendingReleases.clear();
  useProfileLoading.setState({ deferred: true, opened: Object.fromEntries(shownEngineProfiles(s).map((engine) => [engine, true as const])), unloaded: {} });
  const loaded = onProfileLoaded(openProfile);
  let stopped = false;
  loadedProfiles().then(
    (engines) => {
      if (!stopped) for (const engine of engines) openProfile(engine);
    },
    () => {
      if (!stopped) useProfileLoading.setState({ deferred: false });
    },
  );
  const shown = useBrowser.subscribe((next, prev) => {
    if (next.windows === prev.windows && next.profiles === prev.profiles) return;
    for (const engine of shownEngineProfiles(next)) openProfile(engine);
  });
  return () => {
    stopped = true;
    loaded.remove();
    shown();
  };
}
