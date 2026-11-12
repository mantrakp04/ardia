import type { StateCreator } from "zustand";
import type { AdoptId } from "../browser/types";
import type { BrowserState } from "../browser/store";
import { activeTabId, IDLE_LIVE, makeTab, navigationTo, without } from "../browser/model";
import { forgetOpeners, insertionIndex } from "../tabs/openers";
import { groupWithOpener } from "../pins/tabGrouping";
import { adoptedPage, hasNavigatedPage, isAsleep, loadedPage, renavigated } from "../tabs/pageSession";
import { isSmall } from "../windows/small";
import { activated, apply, removeTabs } from "../tabs/tabs";
import { pinnedGroupMembers } from "../browser/structure";
import { orderSections } from "../groups/groups";
import { withoutFragment } from "../../lib/url";

export type PeekPoint = { x: number; y: number };
export type SiteLanding = { host: string; until: number; then: "tab" | "source" };
export type Peek = { tabId: string; sourceId: string; sourcePage: string; from: PeekPoint | null; landing?: SiteLanding };
export type PeekOptions = { adoptId?: AdoptId; landing?: SiteLanding };

export type PeekSlice = {
  peeks: Record<string, Peek>;

  openPeek(sourceTabId: string, url: string, from?: PeekPoint | null, options?: PeekOptions): string;
  closePeek(sourceTabId: string): void;
  peekToTab(windowId: string, options?: { activate?: boolean }): string | undefined;
};

type PeekState = Pick<BrowserState, "peeks" | "tabs">;

const peekable = (url: string) => /^https?:\/\//i.test(url);

type PinState = Pick<BrowserState, "tabs" | "groups" | "settings">;

const isPinnedPage = (s: PinState, id: string) => !!s.tabs[id]?.pin || pinnedGroupMembers(s.groups).has(id);

export const peeksLinksToOtherSites = (s: PinState, id: string) => s.settings.peekLinksToOtherSites && isPinnedPage(s, id);

export function otherSitePeekTabIds(s: PinState): string[] {
  if (!s.settings.peekLinksToOtherSites) return [];
  return Object.keys(s.tabs)
    .filter((id) => isPinnedPage(s, id))
    .sort();
}

export function shownPeek(s: BrowserState, windowId: string): Peek | undefined {
  const source = activeTabId(s, windowId);
  const peek = source ? s.peeks[source] : undefined;
  return peek && s.tabs[peek.tabId]?.windowId === windowId ? peek : undefined;
}

export const peekTabId = (s: BrowserState, windowId: string): string | undefined => shownPeek(s, windowId)?.tabId;

export const shownPageId = (s: BrowserState, windowId: string): string | undefined => peekTabId(s, windowId) ?? activeTabId(s, windowId);

export function peekSourceOf(s: PeekState, id: string | undefined): string | undefined {
  if (!id || !s.tabs[id]) return undefined;
  for (const peek of Object.values(s.peeks)) if (peek.tabId === id) return peek.sourceId;
  return undefined;
}

export const isPeekTab = (s: PeekState, id: string | undefined): boolean => peekSourceOf(s, id) !== undefined;

export const peekTabIds = (peeks: BrowserState["peeks"]): Set<string> => new Set(Object.values(peeks).map((p) => p.tabId));

export function peekOpenedFrom(s: PeekState, sourceTabId: string): string | undefined {
  const peek = s.peeks[sourceTabId];
  return peek && s.tabs[peek.tabId] ? peek.tabId : undefined;
}

export function withoutPeek(s: BrowserState, sourceTabId: string): BrowserState {
  const peek = s.peeks[sourceTabId];
  if (!peek) return s;
  const next = removeTabs(s, [peek.tabId], false);
  return { ...next, peeks: without(next.peeks, [sourceTabId]) };
}

export function settlePeeks(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (s.peeks === prev.peeks && s.tabs === prev.tabs && s.windows === prev.windows) return null;
  let next = s;
  for (const [sourceId, peek] of Object.entries(s.peeks)) {
    const source = s.tabs[sourceId];
    const tab = s.tabs[peek.tabId];
    const stale =
      !tab ||
      !source ||
      !s.windows[tab.windowId] ||
      source.windowId !== tab.windowId ||
      source.profileId !== tab.profileId ||
      isAsleep(source) ||
      withoutFragment(source.url) !== peek.sourcePage;
    if (stale) next = withoutPeek(next, sourceId);
  }
  return next === s ? null : next;
}

export const createPeekSlice: StateCreator<BrowserState, [], [], PeekSlice> = (set, get) => ({
  peeks: {},

  openPeek(sourceTabId, url, from = null, { adoptId, landing } = {}) {
    let s = get();
    const source = s.tabs[sourceTabId];
    const w = source ? s.windows[source.windowId] : undefined;
    if (!source || !w || isSmall(s, w.id) || !peekable(url) || !w.tabIds.includes(sourceTabId)) return "";
    s = withoutPeek(s, sourceTabId);
    if (activeTabId(s, w.id) !== sourceTabId) s = apply(s, activated(s, sourceTabId));
    const tab = { ...makeTab(w.id, source.profileId, url), openerId: sourceTabId, page: adoptId ? adoptedPage(adoptId) : loadedPage(navigationTo(url, true)) };
    const peek: Peek = { tabId: tab.id, sourceId: sourceTabId, sourcePage: withoutFragment(s.tabs[sourceTabId]!.url), from, ...(landing ? { landing } : {}) };
    set({
      ...s,
      tabs: { ...s.tabs, [tab.id]: tab },
      live: { ...s.live, [tab.id]: IDLE_LIVE },
      peeks: { ...s.peeks, [sourceTabId]: peek },
    });
    return tab.id;
  },

  closePeek(sourceTabId) {
    const s = get();
    if (s.peeks[sourceTabId]) set(withoutPeek(s, sourceTabId));
  },

  peekToTab(windowId, { activate = true } = {}) {
    let s = get();
    const peek = shownPeek(s, windowId);
    const tab = peek ? s.tabs[peek.tabId] : undefined;
    if (!peek || !tab || !s.windows[windowId]) return undefined;
    s = { ...s, peeks: without(s.peeks, [peek.sourceId]) };
    if (activate) s = forgetOpeners(s, windowId);
    const loaded = hasNavigatedPage(tab);
    const moved = { ...tab, openerId: s.tabs[peek.sourceId] ? peek.sourceId : null, page: loaded ? renavigated(tab, navigationTo(tab.url)) : tab.page, lastActiveAt: Date.now() };
    const tabs = { ...s.tabs, [tab.id]: moved };
    const w = s.windows[windowId]!;
    const tabIds = [...w.tabIds];
    tabIds.splice(Math.min(insertionIndex({ ...s, tabs }, w, moved, false), tabIds.length), 0, tab.id);
    s = { ...s, tabs, windows: { ...s.windows, [windowId]: { ...w, tabIds: orderSections(tabIds, tabs, s.groups) } } };
    if (moved.openerId) s = groupWithOpener(s, tab.id, moved.openerId, false);
    if (activate) s = apply(s, activated(s, tab.id));
    set(s);
    return tab.id;
  },
});
