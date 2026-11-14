import type { BrowserState } from "../browser/store";
import { withShownTab } from "../groups/shownTabs";
import { inPinnedContainer } from "../browser/model";
import { groupOf, pinnedChildGroup } from "../pins/tabGrouping";
import { splitOf, splitTabIds, splitTabIdsOf } from "../splits/splits";
import type { BrowserWindow, Tab } from "../browser/types";
import { isAsleep } from "./pageSession";

const regular = (s: BrowserState, id: string) => !inPinnedContainer(s, id);

export function insertionIndex(s: BrowserState, w: BrowserWindow, tab: Tab, background: boolean): number {
  const opener = tab.openerId ? s.tabs[tab.openerId] : undefined;
  let index: number;
  if (opener && opener.windowId === w.id && opener.profileId === tab.profileId && regular(s, opener.id)) {
    const panes = splitTabIdsOf(splitOf(s, opener.id)) ?? [opener.id];
    const at = Math.max(...panes.map((id) => w.tabIds.indexOf(id))) + 1;
    index = background ? afterFamily(s, w, tab, at, opener.id) : at;
  } else if (opener && opener.windowId === w.id && opener.profileId === tab.profileId) {
    const gathered = pinnedChildGroup(s, opener.id, tab.profileId);
    index = gathered
      ? Math.max(...gathered.tabIds.map((id) => w.tabIds.indexOf(id))) + 1
      : afterFamily(s, w, tab, firstRegular(s, w, tab.profileId), opener.id);
  } else {
    index = listStart(s, w, tab.profileId);
    if (opener) index = afterFamily(s, w, tab, index, opener.id);
  }
  return outsideSplit(s, w, index);
}

export function firstRegular(s: BrowserState, w: BrowserWindow, profileId: string): number {
  const first = w.tabIds.findIndex((id) => s.tabs[id]?.profileId === profileId && regular(s, id));
  return first >= 0 ? first : w.tabIds.length;
}

export function newTabPlacement(s: BrowserState, w: BrowserWindow, profileId: string | undefined): { index: number; openerId?: string } {
  const profile = w.kind !== "private" && profileId && s.profiles[profileId] ? profileId : w.profileId;
  const beside = s.settings.newTabPosition === "nextToCurrent" ? belowCurrent(s, w, profile) : undefined;
  return beside ?? { index: listStart(s, w, profile) };
}

function belowCurrent(s: BrowserState, w: BrowserWindow, profileId: string): { openerId: string; index: number } | undefined {
  const activeId = w.activeTabIds[profileId];
  const active = activeId ? s.tabs[activeId] : undefined;
  if (!active || active.windowId !== w.id) return undefined;
  if (!regular(s, active.id)) return { openerId: active.id, index: firstRegular(s, w, active.profileId) };
  const panes = splitTabIdsOf(splitOf(s, active.id)) ?? [active.id];
  return { openerId: active.id, index: outsideSplit(s, w, Math.max(...panes.map((id) => w.tabIds.indexOf(id))) + 1) };
}

export function joinedWithCurrent(s: BrowserState, ids: string[], openerId: string | undefined): BrowserState {
  const group = openerId && !inPinnedContainer(s, openerId) ? groupOf(s, openerId) : undefined;
  const joining = group ? ids.filter((id) => !inPinnedContainer(s, id) && s.tabs[id]?.profileId === group.profileId) : [];
  if (!group || !joining.length) return s;
  const members = new Set([...group.tabIds, ...joining]);
  const tabIds = s.windows[group.windowId]!.tabIds.filter((id) => members.has(id));
  const groups = joining.reduce(withShownTab, { ...s.groups, [group.id]: { ...group, tabIds } });
  return { ...s, groups };
}

const listStart = (s: BrowserState, w: BrowserWindow, profileId: string) =>
  s.settings.newTabPosition === "top" ? firstRegular(s, w, profileId) : w.tabIds.length;

function afterFamily(s: BrowserState, w: BrowserWindow, tab: Tab, from: number, openerId: string): number {
  const family = new Set([openerId]);
  const group = s.tabs[openerId]?.windowId === w.id && regular(s, openerId) ? groupOf(s, openerId)?.id : undefined;
  let index = from;
  for (let i = from; i < w.tabIds.length; i++) {
    const t = s.tabs[w.tabIds[i]!];
    if (!t || t.profileId !== tab.profileId) continue;
    if (!t.openerId || !family.has(t.openerId) || groupOf(s, t.id)?.id !== group) break;
    family.add(t.id);
    index = i + 1;
  }
  return index;
}

function outsideSplit(s: BrowserState, w: BrowserWindow, index: number): number {
  const before = w.tabIds[index - 1], after = w.tabIds[index];
  const split = before && after ? splitOf(s, before) : undefined;
  if (!split || !splitTabIds(split).includes(after!)) return index;
  return Math.max(...splitTabIds(split).map((id) => w.tabIds.indexOf(id))) + 1;
}

export function forgetOpeners(s: BrowserState, windowId: string, keep?: string): BrowserState {
  const w = s.windows[windowId];
  const ids = w?.tabIds.filter((id) => id !== keep && s.tabs[id]?.openerId);
  if (!ids?.length) return s;
  const tabs = { ...s.tabs };
  for (const id of ids) tabs[id] = { ...tabs[id]!, openerId: null };
  return { ...s, tabs };
}

export function switchKeepsOpeners(s: BrowserState, from: string, to: string): boolean {
  const a = s.tabs[from]?.openerId ?? null, b = s.tabs[to]?.openerId ?? null;
  return a === b || b === from || a === to;
}

export function closeSuccessor(s: BrowserState, closed: string, order: string[], left: string[]): string | undefined {
  const at = order.indexOf(closed);
  const nearest = [...left.filter((id) => order.indexOf(id) > at), ...left.filter((id) => order.indexOf(id) < at).reverse()];
  const awake = nearest.filter((id) => !isAsleep(s.tabs[id]));
  const pool = awake.length ? awake : nearest;
  const seen = pool.filter((id) => !s.tabs[id]!.unseen);
  if (!seen.length) return pool[0];
  return seen.reduce((best, id) => (s.tabs[id]!.lastActiveAt > s.tabs[best]!.lastActiveAt ? id : best));
}
