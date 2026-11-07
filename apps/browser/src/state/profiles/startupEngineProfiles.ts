import type { Settings } from "../settings/settings";
import type { BrowserState } from "../browser/store";
import { engineProfile, incognitoOriginal, isIncognitoProfile } from "../browser/model";
import { engineProfiles } from "./engineProfiles";

export let selectedProfileReads = false;

export function configureProfileStartup(settings: Pick<Settings, "loadProfilesWhenOpened">) {
  selectedProfileReads = settings.loadProfilesWhenOpened;
}

export function startupEngineProfiles(s: Pick<BrowserState, "profiles" | "windows">, selectedOnly = selectedProfileReads) {
  if (!selectedOnly) return engineProfiles(s);
  return [...new Set(Object.values(s.windows)
    .map((w) => isIncognitoProfile(w.profileId) ? incognitoOriginal(w.profileId) : w.profileId)
    .filter((id) => !!s.profiles[id])
    .map((id) => engineProfile(s, id)))];
}
