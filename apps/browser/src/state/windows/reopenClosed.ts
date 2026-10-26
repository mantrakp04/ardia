import type { BrowserState } from "../browser/store";
import { rejoinGroups } from "../groups/groups";
import { findLast, IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinnedFirst, resolveWindowId, restoreId } from "../browser/model";
import { hasPage } from "../tabs/pageSession";
import { adoptParkedPins } from "../pins/parkedPins";
import { holderOf, swapPinPage } from "../pins/pinShare";
import { lastActiveProfile } from "./small";
import { activated, apply, withNewTab } from "../tabs/tabs";
import type { ClosedTab, ClosedWindow, TabGroup } from "../browser/types";
import { emptyWindow, smallWindow, withWindow } from "./newWindow";

function restoreGroup(groups: Record<string, TabGroup>, g: Omit<TabGroup, "tabIds">, tabIds: string[]): [Record<string, TabGroup>, string] {
  const id = groups[g.id] ? newId("g") : g.id;
  return [{ ...groups, [id]: { ...g, id, tabIds } }, id];
}

export function shownProfile(s: BrowserState, windowId: string | undefined, profileId: string | undefined): boolean {
  return !windowId || profileId === s.windows[windowId]!.profileId;
}

export function lastClosedTab(s: BrowserState, windowId: string | undefined): ClosedTab | undefined {
  return findLast(
    s.closedTabs,
    (c) => canRestoreTabInto(s, c, windowId) && (isIncognitoProfile(c.tab.profileId) || shownProfile(s, windowId, c.tab.profileId)),
  );
}

function canRestoreTabInto(s: BrowserState, c: ClosedTab, windowId: string | undefined): boolean {
  const w = windowId ? s.windows[windowId] : undefined;
  if (isIncognitoProfile(c.tab.profileId)) return c.windowId === windowId;
  return !w?.incognito;
}

export function restoreTab(s: BrowserState, entry: ClosedTab, requested?: string | null): BrowserState {
  const owner = entry.tab.profileId;
  if (entry.pinnedTile && entry.tabId && !s.tabs[entry.tabId] && s.parkedPins[owner]?.tabs.some((p) => p.id === entry.tabId)) {
    const target = resolveWindowId(s, requested);
    let windowId = target && !s.windows[target]!.incognito && s.windows[target]!.profileId === owner ? target : undefined;
    let next = s;
    if (!windowId) {
      windowId = newId("w");
      next = withWindow(next, emptyWindow(windowId, owner, false));
    }
    next = adoptParkedPins(next, windowId, owner);
    if (next.tabs[entry.tabId]) return restoreTab(next, entry, windowId);
  }
  const closedTabs = s.closedTabs.filter((c) => c.id !== entry.id);
  if (entry.small && !isIncognitoProfile(entry.tab.profileId)) {
    const id = newId("w");
    const profileId = s.profiles[entry.tab.profileId] ? entry.tab.profileId : lastActiveProfile(s);
    const next = withWindow({ ...s, closedTabs }, smallWindow(id, profileId));
    return withNewTab(next, id, {
      url: entry.tab.url || undefined,
      profileId,
      snapshot: { ...entry.tab, pinned: false, profileId },
      adoptId: entry.tabId && entry.tab.url ? restoreId(entry.restoreFrom ?? entry.tabId) : undefined,
    })[0];
  }
  const tile = entry.pinnedTile && entry.tabId ? s.tabs[entry.tabId] : undefined;
  const swapped = tile && !hasPage(tile) && holderOf(s, tile.id) ? swapPinPage({ ...s, closedTabs }, tile.id) : null;
  if (swapped) return apply(swapped.state, activated(swapped.state, swapped.holderId));
  if (tile) {
    const unloaded = !hasPage(tile);
    const tabs = unloaded
      ? { ...s.tabs, [tile.id]: { ...tile, url: entry.tab.url, title: entry.tab.title, favicon: entry.tab.favicon, muted: entry.tab.muted, adoptId: restoreId(entry.restoreFrom ?? tile.id) } }
      : s.tabs;
    const next: BrowserState = { ...s, closedTabs, tabs };
    return apply(next, activated(next, tile.id));
  }
  const original = s.windows[entry.windowId];
  let windowId = original && canRestoreTabInto(s, entry, original.id) ? original.id : resolveWindowId(s, requested);
  let next: BrowserState = { ...s, closedTabs };
  if (!windowId || !canRestoreTabInto(s, entry, windowId)) {
    if (isIncognitoProfile(entry.tab.profileId)) return next;
    windowId = newId("w");
    next = withWindow(next, emptyWindow(windowId, s.profiles[entry.tab.profileId] ? entry.tab.profileId : s.settings.defaultProfileId, false));
  }
  const w = next.windows[windowId]!;
  const profileId = isIncognitoProfile(entry.tab.profileId) || s.profiles[entry.tab.profileId] ? entry.tab.profileId : w.profileId;
  const [withTab, tabId] = withNewTab(next, windowId, {
    url: entry.tab.url || undefined,
    profileId,
    snapshot: entry.tab,
    index: w.id === entry.windowId ? entry.index : undefined,
    adoptId: entry.tabId && entry.tab.url ? restoreId(entry.restoreFrom ?? entry.tabId) : undefined,
  });
  next = withTab;
  if (entry.group) next = { ...next, groups: rejoinGroups(next.groups, [entry.group, ...(entry.parents ?? [])], [tabId], windowId, profileId) };
  return next;
}

export function restoreWindow(s: BrowserState, entry: ClosedWindow): BrowserState {
  const id = newId("w");
  const profileOk = (p: string) => (s.profiles[p] ? p : s.settings.defaultProfileId);
  const w = emptyWindow(id, profileOk(entry.window.profileId), false, entry.window.frame);
  w.sidebarOpen = entry.window.sidebarOpen;
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  const ids: string[] = [];
  for (const { active, tabId, ...snap } of entry.tabs) {
    const t = makeTab(id, profileOk(snap.profileId), "", { ...snap, profileId: profileOk(snap.profileId) });
    if (tabId && snap.url) t.wakeAdoptId = restoreId(tabId);
    tabs[t.id] = t;
    live[t.id] = IDLE_LIVE;
    ids.push(t.id);
    if (active || !w.activeTabIds[t.profileId]) w.activeTabIds[t.profileId] = t.id;
  }
  w.tabIds = pinnedFirst(ids, tabs);
  let groups = s.groups;
  const restored = new Map<string, string>();
  for (const { tabIndexes, parentId: _, ...g } of entry.groups) {
    const members = tabIndexes.map((i) => ids[i]).filter((t): t is string => !!t);
    if (!members.length) continue;
    const [next, groupId] = restoreGroup(groups, { ...g, windowId: id }, members);
    groups = next;
    restored.set(g.id, groupId);
  }
  for (const g of entry.groups) {
    const groupId = restored.get(g.id);
    const parent = g.parentId && restored.get(g.parentId);
    if (groupId && parent) groups = { ...groups, [groupId]: { ...groups[groupId]!, parentId: parent } };
  }
  let next = withWindow({ ...s, tabs, live, groups, closedWindows: s.closedWindows.filter((c) => c.id !== entry.id) }, w);
  const shown = w.activeTabIds[w.profileId] ?? w.tabIds[0]!;
  next = adoptParkedPins(next, id, w.profileId);
  next = apply(next, activated(next, shown));
  return next;
}
