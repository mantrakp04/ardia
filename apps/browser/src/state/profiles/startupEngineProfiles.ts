import type { BrowserState } from "../browser/store";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { engineProfiles } from "./engineProfiles";

export let selectedProfileReads = false;

export function configureProfileStartup(settings: { loadProfilesWhenOpened: boolean }) {
  selectedProfileReads = settings.loadProfilesWhenOpened;
}

export function startupEngineProfiles(s: Pick<BrowserState, "profiles" | "windows">, selectedOnly = selectedProfileReads) {
  if (!selectedOnly) return engineProfiles(s);
  return [...new Set(Object.values(s.windows)
    .filter((w) => !!s.profiles[w.profileId] && !isIncognitoProfile(w.profileId))
    .map((w) => engineProfile(s, w.profileId)))];
}
