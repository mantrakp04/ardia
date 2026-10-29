import type { BrowserState } from "../browser/store";
import { leaveGroups } from "../groups/groups";
import { IDLE_LIVE, inPinnedContainer, makeTab, navigationTo, TILE_PIN, viewTabIds, without } from "../browser/model";
import { forgetOpeners, insertionIndex, openerSuccessor } from "./openers";
import { onUrlChange, pruneSelection } from "../pins/organize";
import { isClosedPin } from "../pins/tabCleanup";
import { adoptedPage, ASLEEP, frozenOn, hasOwnOrSharedPage, hasPage, isAsleep, isLazy, loadedPage, needsPage, withWake, wokenPage } from "./pageSession";
import { isPeekTab, withoutPeek } from "../peek/peek";
import { resolveTyped } from "../settings/settings";
import { leavesEmptyWindow } from "../omnibox/newTabBarPolicy";
import { holderOf, withSharedFamily } from "../pins/pinShare";
import { removeFromSplits, splitOf, splitTabIdsOf, withPinnedPanes } from "../splits/splits";
import { closedTabEntry, MAX_CLOSED_TABS } from "../pins/closedTabs";
import { pendingRestore, restoreId } from "./adoptIds";
import type { AdoptId, BrowserWindow, ClosedTab, Tab, TabSnapshot } from "../browser/types";
import { orderSections } from "../groups/groups";
import { samePage } from "../../lib/url";
import { historyOf } from "../history/history";
import { pinHome } from "../pins/pinHomes";

export type NewTabOptions = {
  url?: string;
  background?: boolean;
  adoptId?: AdoptId;
  openerId?: string;
  profileId?: string;
  pinned?: boolean;
  snapshot?: Partial<TabSnapshot>;
  index?: number;
  wakeAdoptId?: AdoptId;
  newTabCommand?: boolean;
};


export type CloseOptions = { lastClosesWindow?: boolean };
export type CloseKind = "close" | "unload" | "removePin";
export type CloseIntent = { kind: CloseKind; ids: string[] };

export function closeKind(s: BrowserState, tabId: string): CloseKind {
  if (!inPinnedContainer(s, tabId)) return "close";
  return isClosedPin(s, tabId) ? "removePin" : "unload";
}

export function openPages(s: BrowserState, tabId: string): string[] {
  const t = s.tabs[tabId];
  if (!t) return [];
  if (hasOwnOrSharedPage(t)) return [tabId];
  const holder = holderOf(s, tabId);
  return holder ? [tabId, holder.id] : [];
}

export function closeIntent(s: BrowserState, tabId: string): CloseIntent {
  const kind = closeKind(s, tabId);
  const pages = kind === "unload" ? openPages(s, tabId) : [];
  return { kind, ids: pages.length ? pages : [tabId] };
}

export function closingTabs(s: BrowserState, ids: string[], { lastClosesWindow = false }: CloseOptions = {}): [BrowserState, string[]] {
  let next = s;
  for (const id of ids) if (isPeekTab(next, id)) next = withoutPeek(next, next.tabs[id]!.windowId);
  const asked = ids.filter((id) => next.tabs[id]);
  next = unloadPinnedTabs(next, asked);
  const gone = asked.filter((id) => !inPinnedContainer(next, id));
  const closedWindows: string[] = [];
  for (const w of Object.values(next.windows)) {
    const view = viewTabIds(next, w.id);
    const shown = view.filter((id) => gone.includes(id));
    if (!shown.length || !view.every((id) => gone.includes(id) || isAsleep(next.tabs[id]))) continue;
    const keepsWindow = !lastClosesWindow || leavesEmptyWindow(shown.length > 1 ? removeTabs(next, shown.slice(1), false) : next, shown[0]!);
    if (keepsWindow) next = withNewTab(next, w.id)[0];
    else closedWindows.push(w.id);
  }
  const removed = gone.filter((id) => !closedWindows.includes(next.tabs[id]!.windowId));
  return [removeTabs(next, removed, true), closedWindows];
}

function pinnedInsertionIndex(s: BrowserState, w: BrowserWindow): number {
  let last = -1;
  w.tabIds.forEach((id, i) => s.tabs[id]?.pin && (last = i));
  return last + 1;
}

export function activated(s: BrowserState, id: string, shareLivePins = true): Partial<BrowserState> {
  const tab = s.tabs[id];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w || s.peeks[w.id]?.tabId === id) return {};
  const lazy = isLazy(tab);
  const holder = lazy && shareLivePins ? holderOf(s, id) : undefined;
  const frozen = lazy && (!!holder || tab.page.kind === "frozen");
  const share = holder ? { page: frozenOn(tab, holder.id), url: holder.url, title: holder.title, favicon: holder.favicon, muted: holder.muted } : {};
  const nextTab: Tab = { ...tab, lastActiveAt: Date.now(), ...(frozen ? share : lazy ? { page: wokenPage(tab) } : {}) };
  const window: BrowserWindow = {
    ...w,
    profileId: w.kind === "private" ? w.profileId : tab.profileId,
    activeTabIds: { ...w.activeTabIds, [tab.profileId]: id },
  };
  const ui = s.windowUi[w.id];
  return {
    tabs: { ...s.tabs, [id]: nextTab },
    windows: { ...s.windows, [w.id]: window },
    ...(ui?.panel.open ? { windowUi: { ...s.windowUi, [w.id]: { ...ui, panel: { open: false, initialText: "" } } } } : {}),
  };
}

export const apply = (s: BrowserState, patch: Partial<BrowserState>): BrowserState => ({ ...s, ...patch });

export function removeTabs(s: BrowserState, ids: string[], record: boolean): BrowserState {
  const gone = new Set(ids.filter((id) => s.tabs[id]));
  if (gone.size === 0) return s;
  const now = Date.now();
  const closed: ClosedTab[] = [];
  let tabs = s.tabs;
  const windows = { ...s.windows };
  const removedWindows: string[] = [];

  for (const w of Object.values(s.windows)) {
    if (!w.tabIds.some((id) => gone.has(id))) continue;
    if (record) {
      w.tabIds.forEach((id, index) => {
        const t = s.tabs[id];
        if (!t || !gone.has(id) || (!t.url && !t.pin)) return;
        closed.push({ ...closedTabEntry(s, t, { windowId: w.id, index }, now), ...(w.kind === "small" ? { small: true } : {}) });
      });
    }
    const tabIds = w.tabIds.filter((id) => !gone.has(id));
    if (tabIds.length === 0) {
      removedWindows.push(w.id);
      delete windows[w.id];
      continue;
    }
    const activeTabIds = { ...w.activeTabIds };
    for (const [profileId, activeId] of Object.entries(w.activeTabIds)) {
      if (!gone.has(activeId)) continue;
      const before = w.tabIds.filter((id) => s.tabs[id]?.profileId === profileId);
      const left = before.filter((id) => !gone.has(id));
      const awake = left.filter((id) => !isAsleep(s.tabs[id]));
      const after = awake.length ? awake : left;
      const index = before.indexOf(activeId);
      const next = openerSuccessor(s, activeId, before, left) ?? after.find((id) => before.indexOf(id) > index) ?? after.at(-1);
      if (next) activeTabIds[profileId] = next;
      else delete activeTabIds[profileId];
    }
    windows[w.id] = { ...w, tabIds, activeTabIds };
  }
  tabs = adoptOrphans(without(tabs, gone), s.tabs, gone);

  let next: BrowserState = {
    ...s,
    tabs,
    windows,
    windowOrder: removedWindows.length ? s.windowOrder.filter((id) => !removedWindows.includes(id)) : s.windowOrder,
    windowUi: removedWindows.length ? without(s.windowUi, removedWindows) : s.windowUi,
    live: without(s.live, gone),
    find: without(s.find, gone),
    groups: leaveGroups(s.groups, gone),
    splits: removeFromSplits(s.splits, gone),
    selection: pruneSelection(s.selection, gone),
    closedTabs: closed.length ? [...s.closedTabs, ...closed].slice(-MAX_CLOSED_TABS) : s.closedTabs,
  };
  for (const w of Object.values(next.windows)) {
    const id = w.activeTabIds[w.profileId];
    const t = id ? next.tabs[id] : undefined;
    if (t && needsPage(t)) next = apply(next, activated(next, t.id));
  }
  return next;
}

function adoptOrphans(tabs: Record<string, Tab>, before: Record<string, Tab>, gone: Set<string>): Record<string, Tab> {
  let next = tabs;
  for (const t of Object.values(tabs)) {
    let opener = t.openerId;
    while (opener && gone.has(opener)) opener = before[opener]?.openerId ?? null;
    if (opener === t.openerId) continue;
    if (next === tabs) next = { ...tabs };
    next[t.id] = { ...t, openerId: opener === t.id ? null : opener };
  }
  return next;
}

export function unloadPinnedTabs(s: BrowserState, requested: string[]): BrowserState {
  const ids = withSharedFamily(s, withPinnedPanes(s, requested.filter((id) => inPinnedContainer(s, id))));
  const closing = new Set([...requested, ...ids]);
  const pinned = ids.filter((id) => inPinnedContainer(s, id));
  if (!pinned.length) return s;
  const gone = new Set(pinned);
  const now = Date.now();
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  const closed: ClosedTab[] = [];
  for (const id of pinned) {
    const t = s.tabs[id]!;
    const w = s.windows[t.windowId];
    const loaded = hasPage(t);
    if (loaded && t.url) {
      closed.push({ ...closedTabEntry(s, t, { windowId: t.windowId, index: w?.tabIds.indexOf(id) ?? 0 }, now, null), pinnedTile: true });
    }
    const back = backToPin(s, t);
    const pending = !back.url && pendingRestore(t) ? restoreId(pendingRestore(t)!) : undefined;
    tabs[id] = { ...t, ...back, page: withWake(ASLEEP, pending) };
    live[id] = IDLE_LIVE;
  }
  let next: BrowserState = {
    ...s,
    tabs,
    live,
    find: without(s.find, gone),
    splits: removeFromSplits(s.splits, new Set(pinned.filter((id) => !splitTabIdsOf(splitOf(s, id))?.every((pane) => gone.has(pane))))),
    selection: pruneSelection(s.selection, gone),
    closedTabs: closed.length ? [...s.closedTabs, ...closed].slice(-MAX_CLOSED_TABS) : s.closedTabs,
  };
  for (const w of Object.values(s.windows)) {
    for (const [profileId, activeId] of Object.entries(w.activeTabIds)) {
      if (!gone.has(activeId)) continue;
      const shown = profileId === w.profileId;
      let replacement = lastRegularTab(s, w, activeId, closing) ?? lastLivePinnedTab(s, w, activeId, closing);
      if (!replacement) [next, replacement] = withNewTab(next, w.id, { profileId, background: !shown });
      if (shown) next = apply(next, activated(next, replacement));
      else {
        const win = next.windows[w.id]!;
        next = { ...next, windows: { ...next.windows, [w.id]: { ...win, activeTabIds: { ...win.activeTabIds, [profileId]: replacement } } } };
      }
    }
  }
  return next;
}

function backToPin(s: BrowserState, t: Tab): Partial<Tab> {
  const home = t.pinnedUrl;
  if (!home || !t.url || samePage(t.url, home)) return {};
  const entry = historyOf(s, t.profileId).find((h) => samePage(h.url, home));
  return { ...onUrlChange(s, t, home), url: home, ...(entry ? { title: entry.title, favicon: entry.favicon ?? t.favicon } : {}) };
}

function lastRegularTab(s: BrowserState, w: BrowserWindow, id: string, closing: Set<string>): string | undefined {
  const profileId = s.tabs[id]!.profileId;
  const candidates = w.tabIds.filter((t) => !closing.has(t) && s.tabs[t]?.profileId === profileId && !inPinnedContainer(s, t));
  const panes = splitTabIdsOf(splitOf(s, id))?.filter((t) => candidates.includes(t)) ?? [];
  const pool = panes.length ? panes : candidates;
  return pool.reduce<string | undefined>((best, t) => (!best || s.tabs[t]!.lastActiveAt > s.tabs[best]!.lastActiveAt ? t : best), undefined);
}

function lastLivePinnedTab(s: BrowserState, w: BrowserWindow, id: string, closing: Set<string>): string | undefined {
  const profileId = s.tabs[id]!.profileId;
  const live = w.tabIds.filter((t) => {
    const tab = s.tabs[t];
    return !closing.has(t) && tab?.profileId === profileId && inPinnedContainer(s, t) && hasPage(tab);
  });
  return live.reduce<string | undefined>((best, t) => (!best || s.tabs[t]!.lastActiveAt > s.tabs[best]!.lastActiveAt ? t : best), undefined);
}

export function withNewTab(s: BrowserState, windowId: string, o: NewTabOptions = {}): [BrowserState, string] {
  if (o.openerId && !o.background) s = forgetOpeners(s, windowId);
  const w = s.windows[windowId];
  if (!w) return [s, ""];
  const profileId = w.kind === "private" ? w.profileId : o.profileId && s.profiles[o.profileId] ? o.profileId : w.profileId;
  const url = o.url ? resolveTyped(s.settings, o.url) : "";
  const tab = makeTab(windowId, profileId, url, { ...o.snapshot, pin: o.pinned === false ? null : (o.snapshot?.pin ?? (o.pinned ? TILE_PIN : null)) });
  if (tab.page.kind === "loaded" && !o.snapshot) tab.page = loadedPage(navigationTo(url, true));
  tab.openerId = o.openerId ?? null;
  tab.pinnedUrl = tab.pin ? pinHome({ pinnedUrl: tab.pinnedUrl, url }, true) : tab.pinnedUrl || null;
  if (o.adoptId) tab.page = adoptedPage(o.adoptId);
  else if (o.wakeAdoptId) tab.page = { kind: "idle", wake: o.wakeAdoptId };
  const tabs = { ...s.tabs, [tab.id]: tab };
  const tabIds = [...w.tabIds];
  const at = o.index ?? (tab.pin ? pinnedInsertionIndex(s, w) : insertionIndex(s, w, tab, !!o.background));
  tabIds.splice(Math.min(at, tabIds.length), 0, tab.id);
  const window: BrowserWindow = {
    ...w,
    tabIds: orderSections(tabIds, tabs, s.groups),
    activeTabIds: w.activeTabIds[profileId] ? w.activeTabIds : { ...w.activeTabIds, [profileId]: tab.id },
  };
  let next: BrowserState = {
    ...s,
    tabs,
    live: { ...s.live, [tab.id]: IDLE_LIVE },
    windows: { ...s.windows, [windowId]: window },
  };
  if (!o.background) next = apply(next, activated(next, tab.id));
  return [next, tab.id];
}
