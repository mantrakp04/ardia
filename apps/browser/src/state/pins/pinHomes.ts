import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { pinnedGroupMembers } from "../browser/structure";
import type { Tab } from "../browser/types";

type HomeSource = Pick<BrowserState, "tabs" | "groups" | "windows">;

export const pinHome = (t: Pick<Tab, "url" | "pinnedUrl">, housed: boolean): string | null => (housed ? t.pinnedUrl || t.url || null : null);

export function settlePinHomes(s: HomeSource, prev: HomeSource): Pick<BrowserState, "tabs"> | null {
  if (s.tabs === prev.tabs && s.groups === prev.groups) return null;
  const members = pinnedGroupMembers(s.groups);
  const ids = s.groups !== prev.groups || s.windows !== prev.windows ? Object.keys(s.tabs) : changedIds(s.tabs, prev.tabs);
  let tabs: Record<string, Tab> | null = null;
  for (const id of ids) {
    const t = s.tabs[id];
    if (!t) continue;
    const home = pinHome(t, !!t.pin || members.has(id));
    if (home === t.pinnedUrl) continue;
    tabs ??= { ...s.tabs };
    tabs[id] = { ...t, pinnedUrl: home };
  }
  return tabs ? { tabs } : null;
}

export function pinnedTabsLeaveLive(s: Pick<BrowserState, "tabs">, prev: Pick<BrowserState, "tabs">): Pick<BrowserState, "tabs"> | null {
  if (s.tabs === prev.tabs) return null;
  let tabs: Record<string, Tab> | null = null;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const t = s.tabs[id];
    if (!t?.pin || !t.liveItem || prev.tabs[id]?.pin) continue;
    tabs ??= { ...s.tabs };
    const { liveItem: _, ...rest } = t;
    tabs[id] = rest;
  }
  return tabs ? { tabs } : null;
}
