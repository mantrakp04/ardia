import type { BrowserState } from "../browser/store";
import { ancestorIds } from "../groups/groups";
import { inPinnedContainer } from "../browser/model";
import { groupOf, pinnedChildGroup } from "../pins/organize";
import { splitOf } from "../splits/splits";
import type { BrowserWindow, Tab } from "../browser/types";

const regular = (s: BrowserState, id: string) => !inPinnedContainer(s, id);

export function insertionIndex(s: BrowserState, w: BrowserWindow, tab: Tab, background: boolean): number {
  const opener = tab.openerId ? s.tabs[tab.openerId] : undefined;
  let index: number;
  if (opener && opener.windowId === w.id && opener.profileId === tab.profileId && regular(s, opener.id)) {
    const panes = splitOf(s, opener.id)?.tabIds ?? [opener.id];
    const at = Math.max(...panes.map((id) => w.tabIds.indexOf(id))) + 1;
    index = background ? afterFamily(s, w, tab, at, opener.id) : at;
  } else if (opener && opener.windowId === w.id && opener.profileId === tab.profileId) {
    const gathered = pinnedChildGroup(s, opener.id, tab.profileId);
    index = gathered
      ? Math.max(...gathered.tabIds.map((id) => w.tabIds.indexOf(id))) + 1
      : afterFamily(s, w, tab, firstRegular(s, w, tab), opener.id);
  } else {
    index = listStart(s, w, tab);
    if (opener) index = afterFamily(s, w, tab, index, opener.id);
  }
  return outsideSplit(s, w, index);
}

function firstRegular(s: BrowserState, w: BrowserWindow, tab: Tab): number {
  const first = w.tabIds.findIndex((id) => s.tabs[id]?.profileId === tab.profileId && regular(s, id));
  return first >= 0 ? first : w.tabIds.length;
}

export function nextToActive(s: BrowserState, windowId: string, profileId: string | undefined): { openerId: string; index: number } | undefined {
  if (s.settings.newTabPosition !== "nextToCurrent") return undefined;
  const w = s.windows[windowId];
  if (!w) return undefined;
  const profile = !w.incognito && profileId && s.profiles[profileId] ? profileId : w.profileId;
  const activeId = w.activeTabIds[profile];
  const active = activeId ? s.tabs[activeId] : undefined;
  if (!active || active.windowId !== w.id) return undefined;
  if (!regular(s, active.id)) return { openerId: active.id, index: firstRegular(s, w, active) };
  const panes = splitOf(s, active.id)?.tabIds ?? [active.id];
  return { openerId: active.id, index: outsideSplit(s, w, Math.max(...panes.map((id) => w.tabIds.indexOf(id))) + 1) };
}

const listStart = (s: BrowserState, w: BrowserWindow, tab: Tab) =>
  s.settings.newTabPosition === "top" ? firstRegular(s, w, tab) : w.tabIds.length;

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
  if (!split?.tabIds.includes(after!)) return index;
  return Math.max(...split.tabIds.map((id) => w.tabIds.indexOf(id))) + 1;
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

const hiddenInGroup = (s: BrowserState, id: string) => {
  const g = groupOf(s, id);
  return !!g && (g.collapsed || ancestorIds(s.groups, g.id).some((x) => s.groups[x]!.collapsed));
};

export function openerSuccessor(s: BrowserState, closed: string, order: string[], left: string[]): string | undefined {
  const at = order.indexOf(closed);
  const candidates = [...left.filter((id) => order.indexOf(id) > at), ...left.filter((id) => order.indexOf(id) < at).reverse()].filter(
    (id) => !s.tabs[id]!.unloaded && !hiddenInGroup(s, id),
  );
  const opener = s.tabs[closed]?.openerId;
  return (
    candidates.find((id) => s.tabs[id]!.openerId === closed) ??
    (opener ? (candidates.find((id) => s.tabs[id]!.openerId === opener) ?? (candidates.includes(opener) ? opener : undefined)) : undefined)
  );
}
