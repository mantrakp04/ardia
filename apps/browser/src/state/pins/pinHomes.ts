import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import type { Tab } from "../browser/types";

type HomeSource = Pick<BrowserState, "tabs" | "groups" | "windows">;

export function pinnedGroupMembers(s: Pick<BrowserState, "groups">): Set<string> {
  const ids = new Set<string>();
  for (const g of Object.values(s.groups)) if (g.pinned) for (const id of g.tabIds) ids.add(id);
  return ids;
}

export function settlePinHomes(s: HomeSource, prev: HomeSource): Pick<BrowserState, "tabs"> | null {
  if (s.tabs === prev.tabs && s.groups === prev.groups) return null;
  const members = pinnedGroupMembers(s);
  const ids = s.groups !== prev.groups || s.windows !== prev.windows ? Object.keys(s.tabs) : changedIds(s.tabs, prev.tabs);
  let tabs: Record<string, Tab> | null = null;
  for (const id of ids) {
    const t = s.tabs[id];
    if (!t) continue;
    const housed = t.pinned || members.has(id);
    const home = housed ? t.pinnedUrl || t.url || null : null;
    if (home === t.pinnedUrl) continue;
    tabs ??= { ...s.tabs };
    tabs[id] = { ...t, pinnedUrl: home };
  }
  return tabs ? { tabs } : null;
}
