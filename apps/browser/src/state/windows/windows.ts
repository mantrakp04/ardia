import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import {
  findLast,
  IDLE_LIVE,
  incognitoProfileId,
  inPinnedContainer,
  isIncognitoProfile,
  navigationTo,
  newId,
  pinKeyOf,
  resolveWindowId,
  snapshotTab,
  viewTabIds,
  without,
} from "../browser/model";
import { restoringGroup } from "../pins/closedTabs";
import { markPinned } from "../pins/pinChoices";
import { hasLoadedPage, hasPage, IDLE, isAsleep, loadedPage, withWake } from "../tabs/pageSession";
import { adoptParkedPins, parkWindowPins } from "../pins/parkedPins";
import { settleMovedPins } from "../pins/pinMirror";
import { returnSharedPages } from "../pins/pinShare";
import { closedWindowEntry, MAX_CLOSED_WINDOWS } from "../pins/closedTabs";
import { pendingRestore } from "../tabs/adoptIds";
import { sharedElsewhere, sharesTabs } from "../tabs/tabShare";
import { isSmall, isSmallWindow, lastActiveProfile, linkProfileOf, mainWindowFor } from "./small";
import { activated, apply, removeTabs, withNewTab } from "../tabs/tabs";
import type { AdoptId, BrowserWindow, ClosedWindow, Frame, ParkedPins, Tab, WindowKind } from "../browser/types";
import { emptyWindow, smallWindow, withWindow } from "./newWindow";
import { lastClosedEntry, lastClosedTab, restoreTab, restoreWindow } from "./reopenClosed";
import { groupTree, regrouped, splitsWithin, withSplitsBack } from "./groupMoves";
import { orderSections } from "../groups/groups";
import { focusedWindowOf } from "./ui";

export type CreateWindowOptions = {
  profileId?: string;
  kind?: WindowKind;
  url?: string;
  adoptId?: AdoptId;
  tabIds?: string[];
  frame?: Frame | null;
  linkPointer?: [number, number];
  background?: boolean;
  chromeWindow?: string;
};

export type WindowsSlice = {
  windows: Record<string, BrowserWindow>;
  windowOrder: string[];
  closedWindows: ClosedWindow[];
  parkedPins: Record<string, ParkedPins>;

  createWindow(options?: CreateWindowOptions): string;
  closeWindow(id: string): void;
  setWindowFrame(id: string, frame: Frame): void;
  setWindowFullScreen(id: string, on: boolean): void;
  toggleSidebar(windowId: string): void;
  switchProfile(windowId: string, profileId: string): void;
  moveTabsToWindow(tabIds: string[], windowId: string | null): string | undefined;
  moveTabToProfile(tabId: string, profileId: string): void;
  moveGroupToWindow(groupId: string, windowId: string | null): string | undefined;
  moveGroupToProfile(groupId: string, profileId: string): void;
  mergeAllWindows(windowId: string): void;
  reopenClosed(windowId?: string | null): void;
  reopenClosedTab(windowId?: string | null): void;
  reopenClosedWindow(): void;
  restoreClosed(entryId: string, windowId?: string | null): void;
};

function lastProfileAfterClosing(s: BrowserState, id: string): string | null {
  const w = s.windows[id];
  if (!w || w.kind === "private" || focusedWindowOf(s) !== id) return s.ui.lastProfileId;
  const next = s.ui.focusOrder.find((f) => f !== id && linkProfileOf(s, s.windows[f]));
  return linkProfileOf(s, next ? s.windows[next] : undefined) ?? s.ui.lastProfileId;
}

export function moveTabsInto(s: BrowserState, ids: string[], targetId: string): BrowserState {
  const target = s.windows[targetId];
  if (!target || isSmallWindow(target)) return s;
  const moving = ids
    .map((id) => s.tabs[id])
    .filter((t): t is Tab => !!t && t.windowId !== targetId && !isIncognitoProfile(t.profileId) && target.kind !== "private");
  if (!moving.length) return s;

  const sources = new Set(moving.map((t) => t.windowId));
  let next = removeTabs(s, moving.map((t) => t.id), false);
  const w = next.windows[targetId]!;
  const tabs = { ...next.tabs };
  const live = { ...next.live };
  const activeTabIds = { ...w.activeTabIds };
  for (const tab of moving) {
    const t = tab;
    const loaded = hasLoadedPage(tab);
    tabs[t.id] = { ...t, windowId: targetId, page: loaded ? loadedPage(navigationTo(t.url)) : hasPage(tab) ? IDLE : tab.page };
    live[t.id] = IDLE_LIVE;
    activeTabIds[t.profileId] ??= t.id;
  }
  next = {
    ...next,
    tabs,
    live,
    windows: { ...next.windows, [targetId]: { ...w, tabIds: orderSections([...w.tabIds, ...moving.map((t) => t.id)], tabs, next.groups), activeTabIds } },
  };
  for (const id of sources) {
    const src = next.windows[id];
    if (!src || viewTabIds(next, id).length) continue;
    const recent = src.tabIds.map((t) => next.tabs[t]!).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (recent) next = apply(next, activated(next, src.activeTabIds[recent.profileId] ?? recent.id));
  }
  return settleMovedPins(s, next, moving.map((t) => t.id), targetId);
}

function intoProfile(s: BrowserState, tabId: string, profileId: string): BrowserState {
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w || w.kind === "private" || !s.profiles[profileId] || tab.profileId === profileId) return s;
  const next = removeTabs(s, [tabId], false);
  const base = next.windows[w.id] ?? { ...w, tabIds: [], activeTabIds: {} };
  const loaded = hasLoadedPage(tab);
  const moved: Tab = { ...tab, profileId, page: loaded ? loadedPage(navigationTo(tab.url)) : hasPage(tab) ? IDLE : withWake(tab.page, undefined), lastActiveAt: Date.now() };
  const pinChoices = tab.pin ? markPinned(next.pinChoices, profileId, { tabs: [pinKeyOf(moved)], placed: [pinKeyOf(moved)] }) : next.pinChoices;
  const tabs = { ...next.tabs, [tabId]: moved };
  const index = Math.min(w.tabIds.indexOf(tabId), base.tabIds.length);
  const tabIds = [...base.tabIds];
  tabIds.splice(index, 0, tabId);
  return {
    ...next,
    tabs,
    pinChoices,
    live: { ...next.live, [tabId]: IDLE_LIVE },
    windows: { ...next.windows, [w.id]: { ...base, tabIds: orderSections(tabIds, tabs, next.groups) } },
    windowOrder: next.windowOrder.includes(w.id) ? next.windowOrder : s.windowOrder,
  };
}

export const createWindowsSlice: StateCreator<BrowserState, [], [], WindowsSlice> = (set, get) => ({
  windows: {},
  windowOrder: [],
  closedWindows: [],
  parkedPins: {},

  createWindow(o = {}) {
    const s = get();
    const id = newId("w");
    const kind = o.kind ?? "main";
    const small = kind === "small";
    const known = o.profileId && s.profiles[o.profileId] ? o.profileId : undefined;
    const original = kind === "private" ? (known ?? lastActiveProfile(s)) : undefined;
    const profileId = original !== undefined
      ? incognitoProfileId(id, original)
      : (known ?? (small ? lastActiveProfile(s) : s.settings.defaultProfileId));
    const w: BrowserWindow =
      kind === "small"
        ? { ...smallWindow(id, profileId, o.frame ?? null), ...(o.linkPointer ? { linkPointer: o.linkPointer } : {}) }
        : { ...emptyWindow(id, profileId, kind, o.frame ?? null), ...(o.chromeWindow ? { chromeWindow: o.chromeWindow } : {}) };
    let next = withWindow(s, w);
    if (o.tabIds?.length && !small) next = moveTabsInto(next, o.tabIds, id);
    if (!next.windows[id]!.tabIds.length) next = withNewTab(next, id, { url: o.url, adoptId: o.adoptId })[0];
    const first = next.windows[id]!.tabIds[0]!;
    const shown = next.windows[id]!.activeTabIds[next.tabs[first]!.profileId] ?? first;
    if (!small) next = adoptParkedPins(next, id, next.tabs[shown]!.profileId);
    next = apply(next, activated(next, shown));
    const focused = focusedWindowOf(s);
    if (o.background && focused && s.windows[focused]) {
      next = {
        ...next,
        ui: { ...next.ui, focusOrder: [focused, id, ...s.ui.focusOrder.filter((w) => w !== focused)], lastProfileId: s.ui.lastProfileId },
      };
    }
    set(next);
    return id;
  },

  closeWindow(id) {
    const s = returnSharedPages(get(), id);
    const w = s.windows[id];
    if (!w) return;
    const tabs = w.tabIds.map((t) => s.tabs[t]).filter((t): t is Tab => !!t && !inPinnedContainer(s, t.id) && !sharedElsewhere(s, t));
    const tabIds = tabs.map((t) => t.id);
    const small = isSmallWindow(w);
    let closedWindows = s.closedWindows;
    if (w.kind !== "private" && !small && tabs.some((t) => t.url)) {
      const active = new Set(Object.values(w.activeTabIds));
      const entry = closedWindowEntry(
        w,
        tabs.map((t) => ({ ...snapshotTab(t), active: active.has(t.id), ...(hasLoadedPage(t) ? { tabId: t.id } : pendingRestore(t) ? { tabId: pendingRestore(t) } : {}) })),
        Object.values(s.groups)
          .filter((g) => g.windowId === id && !g.pinned && (!sharesTabs(s) || g.tabIds.some((t) => tabIds.includes(t))))
          .map(({ tabIds: members, windowId: _, ...g }) => ({ ...g, tabIndexes: members.map((t) => tabIds.indexOf(t)) })),
        Date.now(),
      );
      closedWindows = [...closedWindows, entry].slice(-MAX_CLOSED_WINDOWS);
    }
    const next = removeTabs(s, w.tabIds, small);
    set({
      ...next,
      windows: without(next.windows, [id]),
      windowOrder: next.windowOrder.filter((w) => w !== id),
      windowUi: without(next.windowUi, [id]),
      closedWindows,
      parkedPins: small ? s.parkedPins : parkWindowPins(s.parkedPins, w, s),
      closedTabs: w.kind === "private" ? next.closedTabs.filter((c) => c.windowId !== id) : next.closedTabs,
      ui: {
        ...next.ui,
        focusOrder: next.ui.focusOrder.filter((f) => f !== id),
        lastProfileId: lastProfileAfterClosing(s, id),
      },
    });
  },

  setWindowFrame(id, frame) {
    set((s) => {
      const w = s.windows[id];
      if (!w || (w.frame && w.frame.every((v, i) => v === frame[i]))) return {};
      const windows = { ...s.windows, [id]: { ...w, frame } };
      if (!isSmallWindow(w)) return { windows };
      const size: [number, number] = [Math.round(frame[2]), Math.round(frame[3])];
      const [width, height] = s.settings.littleArdiaSize;
      return size[0] === width && size[1] === height ? { windows } : { windows, settings: { ...s.settings, littleArdiaSize: size } };
    });
  },

  setWindowFullScreen(id, on) {
    set((s) => {
      const w = s.windows[id];
      if (!w || !!w.fullScreen === on) return {};
      const { fullScreen: _, ...rest } = w;
      return { windows: { ...s.windows, [id]: on ? { ...rest, fullScreen: Date.now() } : rest } };
    });
  },

  toggleSidebar(windowId) {
    set((s) => {
      const w = s.windows[windowId];
      return w ? { windows: { ...s.windows, [windowId]: { ...w, sidebarOpen: !w.sidebarOpen } } } : {};
    });
  },

  switchProfile(windowId, profileId) {
    let s = get();
    const w = s.windows[windowId];
    if (!w || w.kind === "private" || isSmallWindow(w) || !s.profiles[profileId] || w.profileId === profileId) return;
    s = adoptParkedPins(s, windowId, profileId);
    const remembered = w.activeTabIds[profileId];
    let target = remembered && s.tabs[remembered]?.windowId === windowId ? remembered : undefined;
    target ??= s.windows[windowId]!.tabIds.find((id) => s.tabs[id]?.profileId === profileId && !isAsleep(s.tabs[id]));
    if (!target) [s, target] = withNewTab(s, windowId, { profileId, background: true });
    s = apply(s, activated(s, target));
    if (focusedWindowOf(s) === windowId) s = { ...s, ui: { ...s.ui, lastProfileId: profileId } };
    set(s);
  },

  moveTabsToWindow(tabIds, windowId) {
    const s = get();
    if (windowId === null) {
      const first = s.tabs[tabIds[0] ?? ""];
      if (!first || isIncognitoProfile(first.profileId)) return undefined;
      return get().createWindow({ profileId: first.profileId, tabIds });
    }
    let next = moveTabsInto(s, tabIds, windowId);
    const last = findLast(tabIds, (id) => next.tabs[id]?.windowId === windowId);
    if (last) next = apply(next, activated(next, last));
    set(next);
    return windowId;
  },

  moveTabToProfile(tabId, profileId) {
    const s = get();
    const next = intoProfile(s, tabId, profileId);
    if (next !== s) set(apply(next, activated(next, tabId)));
  },

  moveGroupToWindow(groupId, windowId) {
    const g = get().groups[groupId];
    if (!g || g.pinned) return undefined;
    const tree = groupTree(get().groups, groupId);
    const kept = splitsWithin(get(), g.tabIds);
    const target = get().moveTabsToWindow(g.tabIds, windowId);
    if (target) set(withSplitsBack(regrouped(get(), tree, target, g.profileId, false), kept, target));
    return target;
  },

  moveGroupToProfile(groupId, profileId) {
    const s = get();
    const g = s.groups[groupId];
    if (!g || g.profileId === profileId || !s.profiles[profileId] || isIncognitoProfile(g.profileId)) return;
    const tree = groupTree(s.groups, groupId);
    const kept = splitsWithin(s, g.tabIds);
    let next = g.tabIds.reduce((acc, id) => intoProfile(acc, id, profileId), s);
    next = withSplitsBack(regrouped(next, tree, g.windowId, profileId, true), kept, g.windowId);
    const last = findLast(g.tabIds, (id) => next.tabs[id]?.profileId === profileId);
    set(last ? apply(next, activated(next, last)) : next);
  },

  mergeAllWindows(windowId) {
    const s = get();
    const target = s.windows[windowId]?.kind === "private" || isSmallWindow(s.windows[windowId]) ? mainWindowFor(s) : windowId;
    if (!target) return;
    const others = s.windowOrder.filter((id) => id !== target && s.windows[id]?.kind !== "private" && !isSmallWindow(s.windows[id]));
    const tabIds = others.flatMap((id) => s.windows[id]!.tabIds);
    if (!tabIds.length) return;
    let next = moveTabsInto(s, tabIds, target);
    const groups = { ...next.groups };
    const taken = new Set(Object.values(next.groups).flatMap((g) => g.tabIds));
    for (const g of Object.values(s.groups)) {
      if (!others.includes(g.windowId)) continue;
      const members = g.tabIds.filter((id) => next.tabs[id]?.windowId === target && !taken.has(id));
      if (members.length) groups[g.id] = { ...g, windowId: target, tabIds: members };
    }
    next = { ...next, groups };
    set(next);
  },

  reopenClosed(windowId) {
    const s = get();
    const entry = lastClosedEntry(s, windowId);
    if (entry) get().restoreClosed(entry.id, resolveWindowId(s, windowId));
  },

  reopenClosedTab(windowId) {
    const s = get();
    const target = resolveWindowId(s, windowId);
    const entry = lastClosedTab(s, target);
    if (entry) get().restoreClosed(entry.id, target);
  },

  reopenClosedWindow() {
    const entry = get().closedWindows.at(-1);
    if (entry) get().restoreClosed(entry.id);
  },

  restoreClosed(entryId, windowId) {
    const s = get();
    if (isSmall(s, windowId)) windowId = mainWindowFor(s) ?? null;
    const closedTab = s.closedTabs.find((c) => c.id === entryId);
    if (closedTab) return set(restoreTab(s, closedTab, windowId));
    const closedWindow = s.closedWindows.find((c) => c.id === entryId);
    if (closedWindow) return set(restoreWindow(s, closedWindow));
    const closedGroup = s.closedGroups.find((c) => c.id === entryId) ?? s.deletedGroups.find((c) => c.id === entryId);
    if (closedGroup) set(restoringGroup(s, closedGroup, windowId));
  },
});
