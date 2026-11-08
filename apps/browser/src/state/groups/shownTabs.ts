import { activeTabId, inPinnedContainer } from "../browser/model";
import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { isAsleep } from "../tabs/pageSession";
import { ancestorIds, innermostGroupOf } from "./groupNesting";

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

export function settleShownTabs(s: BrowserState): Pick<BrowserState, "groups"> | null {
  let groups = s.groups;
  for (const g of Object.values(s.groups)) {
    if (!g.shownTabIds) continue;
    if (!g.collapsed) {
      groups = withoutShownTabs(groups, [g.id]);
      continue;
    }
    const active = activeTabId(s, g.windowId, g.profileId);
    const live = g.shownTabIds.filter((id) => g.tabIds.includes(id) && !(id !== active && inPinnedContainer(s, id) && isAsleep(s.tabs[id])));
    if (live.length !== g.shownTabIds.length) groups = { ...groups, [g.id]: withShown(g, live) };
  }
  return groups === s.groups ? null : { groups };
}
