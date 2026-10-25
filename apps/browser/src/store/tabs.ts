import { resolveInput } from "@ardia/core";
import type { StateCreator } from "zustand";
import { fromLegacyUrl } from "../legacy";
import { startNavigation } from "../lib/earlyNavigate";
import type { BrowserState } from "./browser";
import { ancestorIds, closedGroupInfo, innermostGroupOf, leaveGroups, syncGroupOrder } from "./groups";
import {
  activeTabId,
  closesWindow,
  IDLE_LIVE,
  inPinnedContainer,
  makeTab,
  merge,
  navigationTo,
  newId,
  pendingRestore,
  pinnedFirst,
  pinSection,
  snapshotTab,
  viewTabIds,
  wake,
  without,
} from "./model";
import { forgetOpeners, insertionIndex, nextToActive, openerSuccessor, switchKeepsOpeners } from "./openers";
import { groupWithOpener, onUrlChange, pruneSelection, samePage } from "./organize";
import { searchUrlPrefix } from "./settings";
import { mainWindowFor } from "./small";
import { leavesEmptyWindow } from "./newTabBar";
import { holderOf, swapPinPage, withSharedFamily } from "./pinShare";
import { removeFromSplits, splitOf, withPinnedPanes } from "./splits";
import { engineForUrl, tabEngine, typedNavigationEngine } from "./engines";
import type { BrowserWindow, ClosedTab, Tab, TabLive, TabSnapshot } from "./types";

export type NewTabOptions = {
  url?: string;
  background?: boolean;
  adoptId?: string;
  openerId?: string;
  profileId?: string;
  pinned?: boolean;
  snapshot?: Partial<TabSnapshot>;
  index?: number;
  wakeAdoptId?: string;
  newTabCommand?: boolean;
};

let pinHandoff: (tabId: string, commit: () => void) => void = (_, commit) => commit();
export const setPinHandoff = (handoff: typeof pinHandoff) => {
  pinHandoff = handoff;
};

let openOutsideTab: (url: string, windowId: string) => boolean = () => false;
export const setAppUrlOpener = (open: typeof openOutsideTab) => {
  openOutsideTab = open;
};

export type TabsSlice = {
  tabs: Record<string, Tab>;
  live: Record<string, TabLive>;
  closedTabs: ClosedTab[];

  newTab(windowId: string, options?: NewTabOptions): string;
  closeTab(id: string): void;
  closeTabs(ids: string[]): void;
  activate(id: string): void;
  handOffPin(id: string): void;
  activateIndex(windowId: string, index: number): void;
  cycle(windowId: string, delta: 1 | -1): void;
  navigate(id: string, input: string, options?: { userInitiated?: boolean }): void;
  updateTab(id: string, patch: Partial<Tab>, live?: Partial<TabLive>): void;
  updateLive(id: string, patch: Partial<TabLive>): void;
  navigated(id: string, page: { url: string; title: string }, live: Partial<TabLive>): void;
  faviconChanged(id: string, favicon: string): void;
  duplicateTab(id: string): string | undefined;
  togglePin(id: string): void;
  moveTab(id: string, toIndex: number): void;
};

const MAX_CLOSED_TABS = 50;

function pinnedInsertionIndex(s: BrowserState, w: BrowserWindow): number {
  let last = -1;
  w.tabIds.forEach((id, i) => s.tabs[id]?.pinned && (last = i));
  return last + 1;
}

export function activated(s: BrowserState, id: string, shareLivePins = true): Partial<BrowserState> {
  const tab = s.tabs[id];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w || s.peeks[w.id]?.tabId === id) return {};
  const lazy = !!tab.url && !tab.navigation && !tab.adoptId;
  const holder = lazy && shareLivePins ? holderOf(s, id) : undefined;
  const frozen = lazy && (!!holder || !!tab.pageIn);
  const { unloaded: _, ...rest } = tab;
  const share = holder ? { pageIn: holder.id, url: holder.url, title: holder.title, favicon: holder.favicon, muted: holder.muted } : {};
  const nextTab: Tab = { ...rest, lastActiveAt: Date.now(), ...(frozen ? share : lazy ? wake(tab) : {}) };
  const window: BrowserWindow = {
    ...w,
    profileId: w.incognito ? w.profileId : tab.profileId,
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
        if (!t || !gone.has(id) || (!t.url && !t.pinned)) return;
        const group = innermostGroupOf(s.groups, id);
        const parents = group ? ancestorIds(s.groups, group.id).map((x) => closedGroupInfo(s.groups[x]!)) : [];
        closed.push({
          kind: "tab",
          id: newId("ct"),
          tab: snapshotTab(t),
          tabId: id,
          ...(pendingRestore(t) ? { restoreFrom: pendingRestore(t) } : {}),
          windowId: w.id,
          index,
          group: group ? closedGroupInfo(group) : null,
          ...(parents.length ? { parents } : {}),
          closedAt: now,
          ...(w.kind === "small" ? { small: true } : {}),
        });
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
      const awake = left.filter((id) => !s.tabs[id]?.unloaded);
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
    if (t && t.url && !t.navigation && !t.adoptId && !t.pageIn) next = apply(next, activated(next, t.id));
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
    const loaded = !!(t.navigation || t.adoptId);
    if (loaded && t.url) {
      closed.push({ kind: "tab", id: newId("ct"), tab: snapshotTab(t), tabId: id, windowId: t.windowId, index: w?.tabIds.indexOf(id) ?? 0, group: null, closedAt: now, pinnedTile: true });
    }
    const back = backToPin(s, t);
    const pending = !back.url && pendingRestore(t) ? t.wakeAdoptId : undefined;
    tabs[id] = { ...t, ...back, navigation: null, adoptId: undefined, wakeAdoptId: pending, unloaded: true, pageIn: undefined };
    live[id] = IDLE_LIVE;
  }
  let next: BrowserState = {
    ...s,
    tabs,
    live,
    find: without(s.find, gone),
    splits: removeFromSplits(s.splits, new Set(pinned.filter((id) => !splitOf(s, id)?.tabIds.every((pane) => gone.has(pane))))),
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
  const entry = s.history[t.profileId]?.find((h) => samePage(h.url, home));
  return { ...onUrlChange(s, t, home), url: home, ...(entry ? { title: entry.title, favicon: entry.favicon ?? t.favicon } : {}) };
}

function lastRegularTab(s: BrowserState, w: BrowserWindow, id: string, closing: Set<string>): string | undefined {
  const profileId = s.tabs[id]!.profileId;
  const candidates = w.tabIds.filter((t) => !closing.has(t) && s.tabs[t]?.profileId === profileId && !inPinnedContainer(s, t));
  const panes = splitOf(s, id)?.tabIds.filter((t) => candidates.includes(t)) ?? [];
  const pool = panes.length ? panes : candidates;
  return pool.reduce<string | undefined>((best, t) => (!best || s.tabs[t]!.lastActiveAt > s.tabs[best]!.lastActiveAt ? t : best), undefined);
}

function lastLivePinnedTab(s: BrowserState, w: BrowserWindow, id: string, closing: Set<string>): string | undefined {
  const profileId = s.tabs[id]!.profileId;
  const live = w.tabIds.filter((t) => {
    const tab = s.tabs[t];
    return !closing.has(t) && tab?.profileId === profileId && inPinnedContainer(s, t) && !!(tab.navigation || tab.adoptId);
  });
  return live.reduce<string | undefined>((best, t) => (!best || s.tabs[t]!.lastActiveAt > s.tabs[best]!.lastActiveAt ? t : best), undefined);
}

export function withNewTab(s: BrowserState, windowId: string, o: NewTabOptions = {}): [BrowserState, string] {
  if (o.openerId && !o.background) s = forgetOpeners(s, windowId);
  const w = s.windows[windowId];
  if (!w) return [s, ""];
  const profileId = w.incognito ? w.profileId : o.profileId && s.profiles[o.profileId] ? o.profileId : w.profileId;
  const url = o.url ? resolveInput(fromLegacyUrl(o.url.trim()), searchUrlPrefix(s.settings)) : "";
  const tab = makeTab(windowId, profileId, url, { ...o.snapshot, pinned: o.pinned ?? o.snapshot?.pinned ?? false });
  if (tab.navigation && !o.snapshot) tab.navigation = navigationTo(url, true);
  tab.openerId = o.openerId ?? null;
  tab.pinnedUrl = tab.pinned ? tab.pinnedUrl || url || null : null;
  if (o.adoptId) {
    tab.adoptId = o.adoptId;
    tab.navigation = null;
  } else if (o.wakeAdoptId) {
    tab.wakeAdoptId = o.wakeAdoptId;
    tab.navigation = null;
  }
  const tabs = { ...s.tabs, [tab.id]: tab };
  const tabIds = [...w.tabIds];
  const at = o.index ?? (tab.pinned ? pinnedInsertionIndex(s, w) : insertionIndex(s, w, tab, !!o.background));
  tabIds.splice(Math.min(at, tabIds.length), 0, tab.id);
  const window: BrowserWindow = {
    ...w,
    tabIds: pinnedFirst(tabIds, tabs, s.groups),
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

export const createTabsSlice: StateCreator<BrowserState, [], [], TabsSlice> = (set, get) => ({
  tabs: {},
  live: {},
  closedTabs: [],

  newTab(windowId, options) {
    const small = get().windows[windowId];
    if (small?.kind === "small" && small.tabIds.length) {
      const profileId = options?.profileId ?? small.profileId;
      const main = mainWindowFor(get(), profileId);
      if (!main) {
        const created = get().createWindow({ profileId, url: options?.url, adoptId: options?.adoptId ?? options?.wakeAdoptId, background: options?.background });
        return activeTabId(get(), created) ?? "";
      }
      return get().newTab(main, { ...options, profileId, index: undefined });
    }
    if (options?.url && !options.adoptId && openOutsideTab(resolveInput(fromLegacyUrl(options.url.trim()), searchUrlPrefix(get().settings)), windowId)) return "";
    const beside = options?.newTabCommand && !options.openerId ? nextToActive(get(), windowId, options.profileId) : undefined;
    let [next, id] = withNewTab(get(), windowId, beside ? { ...options, ...beside } : options);
    const typed = beside && next.tabs[id]?.navigation;
    if (typed) next = { ...next, tabs: { ...next.tabs, [id]: { ...next.tabs[id]!, engine: engineForUrl(next, typed.url) } } };
    if (id && options?.openerId) next = groupWithOpener(next, id, options.openerId, !!options.background);
    else if (id && beside && !inPinnedContainer(next, beside.openerId)) next = groupWithOpener(next, id, beside.openerId, false);
    set(next);
    return id;
  },

  closeTab(id) {
    const s = get();
    const tab = s.tabs[id];
    const w = tab && s.windows[tab.windowId];
    if (!tab || !w) return;
    if (s.peeks[w.id]?.tabId === id) return get().closePeek(w.id);
    if (inPinnedContainer(s, id)) return set(unloadPinnedTabs(s, [id]));
    if (leavesEmptyWindow(s, id)) return set(removeTabs(withNewTab(s, w.id)[0], [id], true));
    if (closesWindow(s, id)) return get().closeWindow(w.id);
    set(removeTabs(s, [id], true));
  },

  closeTabs(ids) {
    let s = unloadPinnedTabs(get(), ids);
    const closing = ids.filter((id) => !inPinnedContainer(s, id));
    for (const w of Object.values(s.windows)) {
      const view = viewTabIds(s, w.id);
      if (view.some((id) => closing.includes(id)) && view.every((id) => closing.includes(id) || s.tabs[id]!.unloaded)) {
        s = withNewTab(s, w.id)[0];
      }
    }
    set(removeTabs(s, closing, true));
  },

  activate(id) {
    const s = get();
    const tab = s.tabs[id];
    if (!tab) return;
    if (!tab.navigation && !tab.adoptId && holderOf(s, id)) return pinHandoff(id, () => get().handOffPin(id));
    const shown = activeTabId(s, tab.windowId);
    let next = apply(s, activated(s, id));
    if (shown && shown !== id && !switchKeepsOpeners(s, shown, id)) next = forgetOpeners(next, tab.windowId);
    set(next);
  },

  handOffPin(id) {
    const s = get();
    const tab = s.tabs[id];
    if (!tab) return;
    const swapped = swapPinPage(s, id);
    const base = swapped?.state ?? s;
    const shown = activeTabId(s, tab.windowId);
    const target = swapped?.holderId ?? id;
    let next = apply(base, activated(base, target));
    if (shown && shown !== id && !switchKeepsOpeners(base, shown, target)) next = forgetOpeners(next, tab.windowId);
    set(next);
  },

  activateIndex(windowId, index) {
    const view = viewTabIds(get(), windowId);
    const id = index < 0 ? view.at(-1) : view[index];
    if (id) get().activate(id);
  },

  cycle(windowId, delta) {
    const s = get();
    const view = viewTabIds(s, windowId);
    const i = view.indexOf(s.windows[windowId]?.activeTabIds[s.windows[windowId]!.profileId] ?? "");
    if (view.length) get().activate(view[(i + delta + view.length) % view.length]!);
  },

  navigate(id, input, { userInitiated = true } = {}) {
    const copy = get().tabs[id];
    const holder = copy && !copy.navigation && !copy.adoptId ? holderOf(get(), id) : undefined;
    if (copy && holder) {
      if (activeTabId(get(), copy.windowId) !== id) return get().navigate(holder.id, input, { userInitiated });
      get().handOffPin(id);
      const held = get().tabs[holder.id];
      if (held?.windowId === copy.windowId && !held.pageIn) return get().navigate(held.id, input, { userInitiated });
      return;
    }
    const s = get();
    const url = resolveInput(fromLegacyUrl(input.trim()), searchUrlPrefix(s.settings));
    const tab = s.tabs[id];
    if (!url || !tab) return;
    if (openOutsideTab(url, tab.windowId)) {
      if (get().windowUi[tab.windowId]?.panel.open) get().closePanel(tab.windowId);
      return;
    }
    const { unloaded: _, wakeAdoptId: _kept, ...rest } = tab;
    const base = userInitiated && tab.url ? forgetOpeners(s, tab.windowId) : s;
    const navigation = navigationTo(url, userInitiated);
    const engine = userInitiated ? typedNavigationEngine(s, tab, url) : undefined;
    const switching = !!engine && engine !== tabEngine(s, id);
    if (!switching) startNavigation(id, navigation);
    const page = { ...(engine ? { engine } : {}), ...(switching ? { adoptId: undefined } : {}) };
    set(apply(base, { tabs: { ...base.tabs, [id]: { ...rest, openerId: base.tabs[id]!.openerId, navigation, url: tab.url || url, ...page } } }));
    const ui = get().windowUi[tab.windowId];
    if (ui?.panel.open) get().closePanel(tab.windowId);
  },

  updateTab(id, patch, livePatch) {
    const s = get();
    const tab = s.tabs[id];
    if (!tab) return;
    const url = patch.url;
    const supersedes = !!tab.wakeAdoptId && !("wakeAdoptId" in patch) && (!!patch.navigation || !!patch.adoptId || (url !== undefined && url !== tab.url));
    const change = supersedes ? { ...patch, wakeAdoptId: undefined } : patch;
    const next = merge(tab, url !== undefined && url !== tab.url ? { ...onUrlChange(s, tab, url), ...change } : change);
    const live = livePatch ? s.live[id] : undefined;
    const nextLive = live && livePatch ? merge(live, livePatch) : live;
    if (next === tab && nextLive === live) return;
    set((s) => ({
      ...(next !== tab ? { tabs: { ...s.tabs, [id]: next } } : {}),
      ...(nextLive !== live ? { live: { ...s.live, [id]: nextLive! } } : {}),
    }));
  },

  updateLive(id, patch) {
    const live = get().live[id];
    if (!live) return;
    const next = merge(live, patch);
    if (next !== live) set((s) => ({ live: { ...s.live, [id]: next } }));
  },

  navigated(id, page, live) {
    get().updateTab(id, page, live);
  },

  faviconChanged(id, favicon) {
    get().updateTab(id, { favicon });
  },

  duplicateTab(id) {
    const s = get();
    const source = s.tabs[id];
    if (!source) return undefined;
    const w = s.windows[source.windowId]!;
    const [next, copy] = withNewTab(s, w.id, {
      url: source.url || undefined,
      profileId: source.profileId,
      snapshot: { ...snapshotTab(source), pinned: false },
      index: w.tabIds.indexOf(id) + 1,
      adoptId: source.url ? `clone:${id}` : undefined,
    });
    set(next);
    return copy;
  },

  togglePin(id) {
    const tab = get().tabs[id];
    if (tab) get().pinTabs([id], !tab.pinned);
  },

  moveTab(id, toIndex) {
    set((s) => {
      const tab = s.tabs[id];
      const w = tab && s.windows[tab.windowId];
      if (!tab || !w) return {};
      const inSection = (t: string) => s.tabs[t]?.profileId === tab.profileId && pinSection(s.tabs[t]) === pinSection(tab);
      const section = w.tabIds.filter(inSection);
      const moved = section.filter((t) => t !== id);
      moved.splice(Math.min(Math.max(toIndex, 0), moved.length), 0, id);
      let k = 0;
      const tabIds = w.tabIds.map((t) => (inSection(t) ? moved[k++]! : t));
      const window = { ...w, tabIds };
      return { windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(s.groups, window) };
    });
  },
});
