import { pageKey, type SuggestionResult } from "@ardia/core";
import { isIncognitoProfile } from "../browser/model";
import type { Profile, Tab } from "../browser/types";

export const searchesAllProfiles = (setting: boolean | undefined, profileId: string): boolean => !!setting && !isIncognitoProfile(profileId);

export const inOtherProfile =
  (profileId: string) =>
  (t: Pick<Tab, "profileId">): boolean =>
    t.profileId !== profileId && !isIncognitoProfile(t.profileId);

export function searchedTabs(tabs: Record<string, Tab>, profileId: string, allProfiles: boolean): Tab[] {
  const all = Object.values(tabs);
  const own = all.filter((t) => t.profileId === profileId);
  if (!allProfiles) return own;
  const openHere = new Set(own.map((t) => pageKey(t.url)));
  const other = inOtherProfile(profileId);
  return [...own, ...all.filter((t) => other(t) && !openHere.has(pageKey(t.url)))];
}

export function withTabProfiles(result: SuggestionResult, tabs: Record<string, Tab>, profileId: string, profiles: Record<string, Profile>): SuggestionResult {
  let changed = false;
  const items = result.items.map((s) => {
    if (s.kind !== "page" || !s.tabId) return s;
    const owner = tabs[s.tabId]?.profileId;
    if (!owner || owner === profileId) return s;
    changed = true;
    return { ...s, tabProfile: profiles[owner]?.name ?? "" };
  });
  return changed ? { ...result, items } : result;
}
