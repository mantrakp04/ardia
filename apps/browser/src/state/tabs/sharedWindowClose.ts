import type { BrowserState } from "../browser/store";
import { inPinnedContainer, pinKeyOf } from "../browser/model";
import { orderSections, syncGroupOrder } from "../groups/groups";
import { profilesOf } from "../pins/pinMirror";
import { splitTabIds } from "../splits/splits";
import { isRegularWindow } from "../windows/small";
import { withNavigationAt } from "./pageSession";
import { sharedListTab, sharesTabs } from "./tabShare";
import type { BrowserWindow, Tab } from "../browser/types";

type KeepsTabs = (w: BrowserWindow | undefined) => boolean;

export function sharedElsewhere(s: BrowserState, t: Tab, keepsTabs: KeepsTabs = isRegularWindow): boolean {
  if (!sharedListTab(s, t)) return false;
  const key = pinKeyOf(t);
  return Object.values(s.tabs).some((x) => x.id !== t.id && x.windowId !== t.windowId && x.profileId === t.profileId && pinKeyOf(x) === key && keepsTabs(s.windows[x.windowId]));
}

export function tabsClosedWithWindow(s: BrowserState, windowId: string, keepsTabs: KeepsTabs = isRegularWindow): Tab[] {
  return (s.windows[windowId]?.tabIds ?? []).map((id) => s.tabs[id]).filter((t): t is Tab => !!t && !inPinnedContainer(s, t.id) && !sharedElsewhere(s, t, keepsTabs));
}

export function tabsLostWithWindow(s: BrowserState, windowId: string, keepsTabs: KeepsTabs): Tab[] {
  const handed = new Set(tabsHandedOver(s, windowId, keepsTabs));
  return tabsClosedWithWindow(s, windowId, keepsTabs).filter((t) => !handed.has(t.id));
}

function heirWindow(s: BrowserState, windowId: string, keepsTabs: KeepsTabs): string | undefined {
  return [...new Set([...s.ui.focusOrder, ...s.windowOrder])].find((id) => id !== windowId && keepsTabs(s.windows[id]));
}

export function tabsHandedOver(s: BrowserState, windowId: string, keepsTabs: KeepsTabs = isRegularWindow): string[] {
  const w = s.windows[windowId];
  if (!sharesTabs(s) || !isRegularWindow(w) || !heirWindow(s, windowId, keepsTabs)) return [];
  const held = new Set<string>();
  for (const o of Object.values(s.windows)) if (o.id !== windowId && keepsTabs(o)) for (const p of profilesOf(s, o)) held.add(p);
  return w.tabIds.filter((id) => {
    const t = s.tabs[id];
    return !!t && !held.has(t.profileId) && !!t.url && !t.liveItem && !inPinnedContainer(s, id) && s.peeks[windowId]?.tabId !== id;
  });
}

export function handOverTabs(s: BrowserState, windowId: string, keepsTabs: KeepsTabs = isRegularWindow): BrowserState {
  const ids = tabsHandedOver(s, windowId, keepsTabs);
  const heirId = heirWindow(s, windowId, keepsTabs);
  const heir = heirId ? s.windows[heirId] : undefined;
  const w = s.windows[windowId];
  if (!ids.length || !heir || !w) return s;
  const moving = new Set(ids);
  const tabs = { ...s.tabs };
  for (const id of ids) tabs[id] = { ...tabs[id]!, windowId: heir.id, page: withNavigationAt(tabs[id]!) };
  let groups = s.groups;
  for (const g of Object.values(s.groups)) {
    if (g.windowId !== windowId || g.pinned || !g.tabIds.length || !g.tabIds.every((id) => moving.has(id))) continue;
    if (groups === s.groups) groups = { ...s.groups };
    groups[g.id] = { ...g, windowId: heir.id };
  }
  let splits = s.splits;
  for (const v of Object.values(s.splits)) {
    if (v.windowId !== windowId || !splitTabIds(v).every((id) => moving.has(id))) continue;
    if (splits === s.splits) splits = { ...s.splits };
    splits[v.id] = { ...v, windowId: heir.id };
  }
  const activeTabIds = { ...heir.activeTabIds };
  for (const id of ids) {
    const profileId = tabs[id]!.profileId;
    const was = w.activeTabIds[profileId];
    activeTabIds[profileId] ??= was && moving.has(was) ? was : id;
  }
  const window = { ...heir, tabIds: orderSections([...heir.tabIds, ...ids], tabs, groups), activeTabIds };
  const left = { ...w, tabIds: w.tabIds.filter((id) => !moving.has(id)), activeTabIds: Object.fromEntries(Object.entries(w.activeTabIds).filter(([, id]) => !moving.has(id))) };
  return { ...s, tabs, groups: syncGroupOrder(groups, window), splits, windows: { ...s.windows, [heir.id]: window, [windowId]: left } };
}
