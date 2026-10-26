import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { activeTabId, IDLE_LIVE, makeTab, navigationTo, pinnedFirst, without } from "../browser/model";
import { forgetOpeners, insertionIndex } from "../tabs/openers";
import { groupWithOpener } from "../pins/organize";
import { hasNavigatedPage } from "../tabs/pageSession";
import { isSmall } from "../windows/small";
import { activated, apply, removeTabs } from "../tabs/tabs";

export type PeekPoint = { x: number; y: number };
export type Peek = { tabId: string; sourceId: string; sourcePage: string; from: PeekPoint | null };

export type PeekSlice = {
  peeks: Record<string, Peek>;

  openPeek(sourceTabId: string, url: string, from?: PeekPoint | null): string;
  closePeek(windowId: string): void;
  peekToTab(windowId: string, options?: { activate?: boolean }): string | undefined;
};

type PeekState = Pick<BrowserState, "peeks" | "tabs">;

const samePageKey = (url: string) => url.replace(/#.*$/, "");
const peekable = (url: string) => /^https?:\/\//i.test(url);

export const peekTabId = (s: Pick<BrowserState, "peeks">, windowId: string): string | undefined => s.peeks[windowId]?.tabId;

export const shownPageId = (s: BrowserState, windowId: string): string | undefined => peekTabId(s, windowId) ?? activeTabId(s, windowId);

export function isPeekTab(s: PeekState, id: string | undefined): boolean {
  const tab = id ? s.tabs[id] : undefined;
  return !!tab && s.peeks[tab.windowId]?.tabId === id;
}

export function peekSourceOf(s: PeekState, id: string | undefined): string | undefined {
  const tab = id ? s.tabs[id] : undefined;
  const peek = tab ? s.peeks[tab.windowId] : undefined;
  return peek && peek.tabId === id ? peek.sourceId : undefined;
}

export function withoutPeek(s: BrowserState, windowId: string): BrowserState {
  const peek = s.peeks[windowId];
  if (!peek) return s;
  const next = removeTabs(s, [peek.tabId], false);
  return { ...next, peeks: without(next.peeks, [windowId]) };
}

export function settlePeeks(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (s.peeks === prev.peeks && s.tabs === prev.tabs && s.windows === prev.windows) return null;
  let next = s;
  for (const [windowId, peek] of Object.entries(s.peeks)) {
    const source = s.tabs[peek.sourceId];
    const stale =
      !s.windows[windowId] ||
      !s.tabs[peek.tabId] ||
      !source ||
      activeTabId(s, windowId) !== peek.sourceId ||
      samePageKey(source.url) !== peek.sourcePage;
    if (stale) next = withoutPeek(next, windowId);
  }
  return next === s ? null : next;
}

export const createPeekSlice: StateCreator<BrowserState, [], [], PeekSlice> = (set, get) => ({
  peeks: {},

  openPeek(sourceTabId, url, from = null) {
    let s = get();
    const source = s.tabs[sourceTabId];
    const w = source ? s.windows[source.windowId] : undefined;
    if (!source || !w || isSmall(s, w.id) || !peekable(url) || !w.tabIds.includes(sourceTabId)) return "";
    s = withoutPeek(s, w.id);
    if (activeTabId(s, w.id) !== sourceTabId) s = apply(s, activated(s, sourceTabId));
    const tab = { ...makeTab(w.id, source.profileId, url), openerId: sourceTabId, navigation: navigationTo(url, true) };
    set({
      ...s,
      tabs: { ...s.tabs, [tab.id]: tab },
      live: { ...s.live, [tab.id]: IDLE_LIVE },
      peeks: { ...s.peeks, [w.id]: { tabId: tab.id, sourceId: sourceTabId, sourcePage: samePageKey(s.tabs[sourceTabId]!.url), from } },
    });
    return tab.id;
  },

  closePeek(windowId) {
    const s = get();
    if (s.peeks[windowId]) set(withoutPeek(s, windowId));
  },

  peekToTab(windowId, { activate = true } = {}) {
    let s = get();
    const peek = s.peeks[windowId];
    const tab = peek ? s.tabs[peek.tabId] : undefined;
    if (!peek || !tab || !s.windows[windowId]) return undefined;
    s = { ...s, peeks: without(s.peeks, [windowId]) };
    if (activate) s = forgetOpeners(s, windowId);
    const loaded = hasNavigatedPage(tab);
    const moved = { ...tab, openerId: s.tabs[peek.sourceId] ? peek.sourceId : null, navigation: loaded ? navigationTo(tab.url) : tab.navigation, lastActiveAt: Date.now() };
    const tabs = { ...s.tabs, [tab.id]: moved };
    const w = s.windows[windowId]!;
    const tabIds = [...w.tabIds];
    tabIds.splice(Math.min(insertionIndex({ ...s, tabs }, w, moved, false), tabIds.length), 0, tab.id);
    s = { ...s, tabs, windows: { ...s.windows, [windowId]: { ...w, tabIds: pinnedFirst(tabIds, tabs) } } };
    if (moved.openerId) s = groupWithOpener(s, tab.id, moved.openerId, false);
    if (activate) s = apply(s, activated(s, tab.id));
    set(s);
    return tab.id;
  },
});
