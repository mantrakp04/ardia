import { activeTabId, inPinnedContainer } from "../browser/model";
import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { isAsleep } from "../tabs/pageSession";
import { ancestorIds, descendantIds, innermostGroupOf } from "./groupNesting";

function withShown(g: TabGroup, ids: string[]): TabGroup {
  const { shownTabIds: _, ...rest } = g;
  return ids.length ? { ...rest, shownTabIds: ids } : rest;
}

export function withoutShownTabs(groups: Record<string, TabGroup>, ids: string[]): Record<string, TabGroup> {
  const next = { ...groups };
  for (const id of ids) if (next[id]?.shownTabIds) next[id] = withShown(next[id]!, []);
  return next;
}

export function withShownTab(groups: Record<string, TabGroup>, tabId: string): Record<string, TabGroup> {
  const inner = innermostGroupOf(groups, tabId);
  if (!inner) return groups;
  let next = groups;
  for (const id of [inner.id, ...ancestorIds(groups, inner.id)]) {
    const g = groups[id]!;
    if (g.collapsed && !g.shownTabIds?.includes(tabId)) next = { ...next, [id]: withShown(g, [...(g.shownTabIds ?? []), tabId]) };
  }
  return next;
}

function shownThrough(groups: Record<string, TabGroup>, tabId: string, outerId: string): boolean {
  for (let g = innermostGroupOf(groups, tabId); g && g.id !== outerId; g = g.parentId ? groups[g.parentId] : undefined) {
    if (g.collapsed && !g.shownTabIds?.includes(tabId)) return false;
  }
  return true;
}

export function settleShownTabs(s: BrowserState, prev: BrowserState): Pick<BrowserState, "groups"> | null {
  const movedHidden = (id: string, outerId: string) => {
    const was = innermostGroupOf(prev.groups, id);
    return !!was && was.id !== innermostGroupOf(s.groups, id)?.id && !shownThrough(s.groups, id, outerId);
  };
  const toggled = Object.values(s.groups).filter((g) => prev.groups[g.id] && prev.groups[g.id]!.collapsed !== g.collapsed);
  let groups = toggled.reduce((next, g) => withoutShownTabs(next, descendantIds(s.groups, g.id)), s.groups);
  for (const g of toggled) {
    const active = activeTabId(s, g.windowId, g.profileId);
    if (g.collapsed && active && g.tabIds.includes(active)) groups = withShownTab(groups, active);
  }
  for (const g of Object.values(groups)) {
    if (!g.shownTabIds) continue;
    if (!g.collapsed) {
      groups = withoutShownTabs(groups, [g.id]);
      continue;
    }
    const active = activeTabId(s, g.windowId, g.profileId);
    const live = g.shownTabIds.filter(
      (id) => g.tabIds.includes(id) && !movedHidden(id, g.id) && !(id !== active && inPinnedContainer(s, id) && isAsleep(s.tabs[id])),
    );
    if (live.length !== g.shownTabIds.length) groups = { ...groups, [g.id]: withShown(g, live) };
  }
  return groups === s.groups ? null : { groups };
}
