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
  pendingRestore,
  pinnedFirst,
  resolveWindowId,
  snapshotTab,
  viewTabIds,
  without,
} from "../browser/model";
import { nextPinChoice, placeChoiceKey, restoringGroup } from "../pins/organize";
import { hasLoadedPage } from "../tabs/pageSession";
import { adoptParkedPins, parkWindowPins } from "../pins/parkedPins";
import { settleMovedPins } from "../pins/pinMirror";
import { returnSharedPages } from "../pins/pinShare";
import { sharedElsewhere, sharesTabs } from "../tabs/tabShare";
import { isSmall, isSmallWindow, lastActiveProfile, linkProfileOf, mainWindowFor } from "./small";
import { activated, apply, removeTabs, withNewTab } from "../tabs/tabs";
import type { BrowserWindow, ClosedWindow, Frame, ParkedPins, Tab } from "../browser/types";
import { emptyWindow, smallWindow, withWindow } from "./newWindow";
import { lastClosedTab, restoreTab, restoreWindow, shownProfile } from "./reopenClosed";

export type CreateWindowOptions = {
  profileId?: string;
  incognito?: boolean;
  url?: string;
  adoptId?: string;
  tabIds?: string[];
  frame?: Frame | null;
  small?: boolean;
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
  mergeAllWindows(windowId: string): void;
  reopenClosed(windowId?: string | null): void;
  reopenClosedTab(windowId?: string | null): void;
  reopenClosedWindow(): void;
  restoreClosed(entryId: string, windowId?: string | null): void;
};

const MAX_CLOSED_WINDOWS = 10;

function lastProfileAfterClosing(s: BrowserState, id: string): string | null {
  const w = s.windows[id];
  if (!w || w.incognito || s.ui.focusedWindowId !== id) return s.ui.lastProfileId;
  const next = s.ui.focusOrder.find((f) => f !== id && linkProfileOf(s, s.windows[f]));
  return linkProfileOf(s, next ? s.windows[next] : undefined) ?? s.ui.lastProfileId;
}

export function moveTabsInto(s: BrowserState, ids: string[], targetId: string): BrowserState {
  const target = s.windows[targetId];
  if (!target || isSmallWindow(target)) return s;
  const moving = ids
    .map((id) => s.tabs[id])
    .filter((t): t is Tab => !!t && t.windowId !== targetId && !isIncognitoProfile(t.profileId) && !target.incognito);
  if (!moving.length) return s;

  const sources = new Set(moving.map((t) => t.windowId));
  let next = removeTabs(s, moving.map((t) => t.id), false);
  const w = next.windows[targetId]!;
  const tabs = { ...next.tabs };
  const live = { ...next.live };
  const activeTabIds = { ...w.activeTabIds };
  for (const tab of moving) {
    const { adoptId: _adopted, ...t } = tab;
    const loaded = hasLoadedPage(tab);
    tabs[t.id] = { ...t, windowId: targetId, navigation: loaded ? navigationTo(t.url) : null };
    live[t.id] = IDLE_LIVE;
    activeTabIds[t.profileId] ??= t.id;
  }
  next = {
    ...next,
    tabs,
    live,
    windows: { ...next.windows, [targetId]: { ...w, tabIds: pinnedFirst([...w.tabIds, ...moving.map((t) => t.id)], tabs, next.groups), activeTabIds } },
  };
  for (const id of sources) {
    const src = next.windows[id];
    if (!src || viewTabIds(next, id).length) continue;
    const recent = src.tabIds.map((t) => next.tabs[t]!).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (recent) next = apply(next, activated(next, src.activeTabIds[recent.profileId] ?? recent.id));
  }
  return settleMovedPins(s, next, moving.map((t) => t.id), targetId);
}

export const createWindowsSlice: StateCreator<BrowserState, [], [], WindowsSlice> = (set, get) => ({
  windows: {},
  windowOrder: [],
  closedWindows: [],
  parkedPins: {},

  createWindow(o = {}) {
    const s = get();
    const id = newId("w");
    const small = !!o.small && !o.incognito;
    const known = o.profileId && s.profiles[o.profileId] ? o.profileId : undefined;
    const original = o.incognito ? (known ?? lastActiveProfile(s)) : undefined;
    const profileId = original !== undefined
      ? incognitoProfileId(id, original)
      : (known ?? (small ? lastActiveProfile(s) : s.settings.defaultProfileId));
    const w = small ? smallWindow(id, profileId, o.frame ?? null) : emptyWindow(id, profileId, !!o.incognito, o.frame ?? null);
    if (original !== undefined) w.originalProfileId = original;
    if (small && o.linkPointer) w.linkPointer = o.linkPointer;
    if (o.chromeWindow && !small) w.chromeWindow = o.chromeWindow;
    let next = withWindow(s, w);
    if (o.tabIds?.length && !small) next = moveTabsInto(next, o.tabIds, id);
    if (!next.windows[id]!.tabIds.length) next = withNewTab(next, id, { url: o.url, adoptId: o.adoptId })[0];
    const first = next.windows[id]!.tabIds[0]!;
    const shown = next.windows[id]!.activeTabIds[next.tabs[first]!.profileId] ?? first;
    if (!small) next = adoptParkedPins(next, id, next.tabs[shown]!.profileId);
    next = apply(next, activated(next, shown));
    const focused = s.ui.focusedWindowId;
    if (o.background && focused && s.windows[focused]) {
      next = {
        ...next,
        ui: { ...next.ui, focusedWindowId: focused, focusOrder: [focused, id, ...s.ui.focusOrder.filter((w) => w !== focused)], lastProfileId: s.ui.lastProfileId },
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
    if (!w.incognito && !small && tabs.some((t) => t.url)) {
      const active = new Set(Object.values(w.activeTabIds));
      const entry: ClosedWindow = {
        kind: "window",
        id: newId("cw"),
        window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
        tabs: tabs.map((t) => ({ ...snapshotTab(t), active: active.has(t.id), ...(hasLoadedPage(t) ? { tabId: t.id } : pendingRestore(t) ? { tabId: pendingRestore(t) } : {}) })),
        groups: Object.values(s.groups)
          .filter((g) => g.windowId === id && !g.pinned && (!sharesTabs(s) || g.tabIds.some((t) => tabIds.includes(t))))
          .map(({ tabIds: members, windowId: _, ...g }) => ({ ...g, tabIndexes: members.map((t) => tabIds.indexOf(t)) })),
        closedAt: Date.now(),
      };
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
      closedTabs: w.incognito ? next.closedTabs.filter((c) => c.windowId !== id) : next.closedTabs,
      ui: {
        ...next.ui,
        focusOrder: next.ui.focusOrder.filter((f) => f !== id),
        focusedWindowId: next.ui.focusedWindowId === id ? (next.ui.focusOrder.find((f) => f !== id) ?? null) : next.ui.focusedWindowId,
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
      const [width, height] = s.settings.littleArdiaSize ?? [];
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
    if (!w || w.incognito || isSmallWindow(w) || !s.profiles[profileId] || w.profileId === profileId) return;
    s = adoptParkedPins(s, windowId, profileId);
    const remembered = w.activeTabIds[profileId];
    let target = remembered && s.tabs[remembered]?.windowId === windowId ? remembered : undefined;
    target ??= s.windows[windowId]!.tabIds.find((id) => s.tabs[id]?.profileId === profileId && !s.tabs[id]!.unloaded);
    if (!target) [s, target] = withNewTab(s, windowId, { profileId, background: true });
    s = apply(s, activated(s, target));
    if (s.ui.focusedWindowId === windowId) s = { ...s, ui: { ...s.ui, lastProfileId: profileId } };
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
    const tab = s.tabs[tabId];
    const w = tab && s.windows[tab.windowId];
    if (!tab || !w || w.incognito || !s.profiles[profileId] || tab.profileId === profileId) return;
    let next = removeTabs(s, [tabId], false);
    const base = next.windows[w.id] ?? { ...w, tabIds: [], activeTabIds: {} };
    const loaded = hasLoadedPage(tab);
    const { adoptId: _, wakeAdoptId: _w, ...rest } = tab;
    const moved: Tab = { ...rest, profileId, navigation: loaded ? navigationTo(tab.url) : null, lastActiveAt: Date.now() };
    const movedKey = moved.pinKey ?? moved.id;
    const pinChoices = tab.pinned
      ? { ...next.pinChoices, [profileId]: { ...next.pinChoices[profileId], [movedKey]: nextPinChoice(), [placeChoiceKey(movedKey)]: nextPinChoice() } }
      : next.pinChoices;
    const tabs = { ...next.tabs, [tabId]: moved };
    const index = Math.min(w.tabIds.indexOf(tabId), base.tabIds.length);
    const tabIds = [...base.tabIds];
    tabIds.splice(index, 0, tabId);
    next = {
      ...next,
      tabs,
      pinChoices,
      live: { ...next.live, [tabId]: IDLE_LIVE },
      windows: { ...next.windows, [w.id]: { ...base, tabIds: pinnedFirst(tabIds, tabs, next.groups) } },
      windowOrder: next.windowOrder.includes(w.id) ? next.windowOrder : s.windowOrder,
    };
    set(apply(next, activated(next, tabId)));
  },

  mergeAllWindows(windowId) {
    const s = get();
    const target = s.windows[windowId]?.incognito || isSmallWindow(s.windows[windowId]) ? mainWindowFor(s) : windowId;
    if (!target) return;
    const others = s.windowOrder.filter((id) => id !== target && !s.windows[id]?.incognito && !isSmallWindow(s.windows[id]));
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
    const target = resolveWindowId(s, windowId);
    const lastTab = lastClosedTab(s, target);
    const regular = (p: string | undefined) => !s.windows[target ?? ""]?.incognito && shownProfile(s, target, p);
    const lastWindow = findLast(s.closedWindows, (c) => regular(c.window.profileId));
    const lastGroup = findLast(s.closedGroups, (c) => regular(c.tabs[0]?.profileId));
    const entry = [lastWindow, lastGroup, lastTab].reduce<{ id: string; closedAt: number } | undefined>(
      (latest, e) => (e && (!latest || e.closedAt > latest.closedAt) ? e : latest),
      undefined,
    );
    if (entry) get().restoreClosed(entry.id, target);
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
