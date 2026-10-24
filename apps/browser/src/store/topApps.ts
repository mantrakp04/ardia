import type { BrowserState } from "./browser";
import { isIncognitoProfile } from "./model";
import type { Tab } from "./types";

export const isTopApp = (t: Pick<Tab, "pinned" | "pinnedAsRow">) => t.pinned && !t.pinnedAsRow;

const dataIdOf = (s: Pick<BrowserState, "profiles">, profileId: string) => {
  const p = isIncognitoProfile(profileId) ? undefined : s.profiles[profileId];
  return p ? (p.dataId ?? p.id) : undefined;
};

export function topAppsShared(s: Pick<BrowserState, "profiles" | "settings">, a: string, b: string): boolean {
  if (a === b || !s.settings.shareTopApps) return false;
  const data = dataIdOf(s, a);
  return !!data && data === dataIdOf(s, b);
}

export const sameTopApp = (s: Pick<BrowserState, "profiles" | "settings">, a: Tab, b: Tab) =>
  isTopApp(a) && isTopApp(b) && topAppsShared(s, a.profileId, b.profileId);

export function topAppCircles(s: Pick<BrowserState, "profiles" | "profileOrder" | "settings">): string[][] {
  if (!s.settings.shareTopApps) return [];
  const circles = new Map<string, string[]>();
  for (const id of s.profileOrder) {
    const data = dataIdOf(s, id);
    if (data) circles.set(data, [...(circles.get(data) ?? []), id]);
  }
  return [...circles.values()].filter((ids) => ids.length > 1);
}
