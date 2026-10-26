import { resolveInput } from "@ardia/core";
import type { StateCreator } from "zustand";
import { fromLegacyUrl } from "../../lib/legacy";
import { startNavigation } from "../../platform/earlyNavigate";
import type { BrowserState } from "../browser/store";
import { syncGroupOrder } from "../groups/groups";
import { activeTabId, inPinnedContainer, merge, navigationTo, pinSection, snapshotTab, viewTabIds } from "../browser/model";
import { forgetOpeners, nextToActive, switchKeepsOpeners } from "./openers";
import { groupWithOpener, onUrlChange } from "../pins/organize";
import { stepDrop } from "../drag/drops";
import { searchUrlPrefix } from "../settings/settings";
import { mainWindowFor } from "../windows/small";
import { holderOf, swapPinPage } from "../pins/pinShare";
import { engineForUrl, tabEngine, typedNavigationEngine } from "../engines/engines";
import type { ClosedTab, Tab, TabLive } from "../browser/types";
import { activated, apply, closingTabs, withNewTab, type CloseOptions, type NewTabOptions } from "./tabs";

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
  closeTabs(ids: string[], options?: CloseOptions): void;
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
  moveTabBy(id: string, delta: 1 | -1): void;
};

function tabSection(s: BrowserState, id: string): string[] {
  const tab = s.tabs[id];
  const w = tab && s.windows[tab.windowId];
  if (!w) return [];
  return w.tabIds.filter((t) => s.tabs[t]?.profileId === tab.profileId && pinSection(s.tabs[t]) === pinSection(tab));
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
    get().closeTabs([id], { lastClosesWindow: true });
  },

  closeTabs(ids, options) {
    const [next, closedWindows] = closingTabs(get(), ids, options);
    set(next);
    for (const windowId of closedWindows) get().closeWindow(windowId);
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
      const section = tabSection(s, id);
      const inSection = new Set(section);
      const moved = section.filter((t) => t !== id);
      moved.splice(Math.min(Math.max(toIndex, 0), moved.length), 0, id);
      let k = 0;
      const tabIds = w.tabIds.map((t) => (inSection.has(t) ? moved[k++]! : t));
      const window = { ...w, tabIds };
      return { windows: { ...s.windows, [w.id]: window }, groups: syncGroupOrder(s.groups, window) };
    });
  },

  moveTabBy(id, delta) {
    get().dropTabs([id], stepDrop(get(), id, delta));
  },
});
