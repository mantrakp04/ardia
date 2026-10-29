import { createContext, useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import { isBookmarked } from "../bookmarks/bookmarks";
import { useBrowser, type BrowserState } from "./store";
import { activeTabId, bookmarkSpaceId, IDLE_LIVE, spaceFor, tabLayoutOf } from "./model";
import type { Settings } from "../settings/settings";
import type { BrowserWindow, FindState, Space, Tab, TabGroup, TabLive } from "./types";
import { CLOSED_FIND, DEFAULT_WINDOW_UI } from "../windows/ui";
import { downloadsIn } from "../downloads/downloadsSlice";
import { focusedWindowOf } from "../windows/ui";

export const WindowContext = createContext<string | null>(null);

export function useWindowId(): string {
  return useContext(WindowContext) ?? focusedWindowOf(useBrowser.getState()) ?? "";
}

function useWindowField<T>(select: (w: BrowserWindow) => T, fallback: T): T {
  const id = useWindowId();
  return useBrowser((s) => {
    const w = s.windows[id];
    return w ? select(w) : fallback;
  });
}

export const PageSpaceContext = createContext<string | null>(null);

export function usePageSpaceId(): string {
  const page = useContext(PageSpaceContext);
  const own = useWindowSpaceId();
  return page ?? own;
}

export const useIsIncognito = () => useWindowField((w) => w.kind === "private", false);
export const useSidebarOpen = () => useWindowField((w) => w.sidebarOpen, true);
export const useWindowSpaceId = () => useWindowField((w) => w.spaceId, "");

export function useWindowSpace(): Space {
  const spaceId = useWindowSpaceId();
  return useBrowser((s) => spaceFor(s, spaceId));
}

export const useSpaces = (): Space[] => useBrowser(useShallow((s) => s.spaceOrder.map((id) => s.spaces[id]!)));

export function useActiveTabId(): string | undefined {
  const id = useWindowId();
  return useBrowser((s) => activeTabId(s, id));
}

export function useActiveTab(): Tab | undefined {
  const id = useWindowId();
  return useBrowser((s) => {
    const active = activeTabId(s, id);
    return active ? s.tabs[active] : undefined;
  });
}

export const useIsActiveTab = (tabId: string) =>
  useBrowser((s) => {
    const tab = s.tabs[tabId];
    return !!tab && activeTabId(s, tab.windowId, tab.spaceId) === tabId;
  });

export function useTab(tabId: string | undefined): Tab | undefined;
export function useTab<T>(tabId: string | undefined, select: (tab: Tab | undefined) => T): T;
export function useTab<T>(tabId: string | undefined, select?: (tab: Tab | undefined) => T) {
  return useBrowser((s) => {
    const tab = tabId ? s.tabs[tabId] : undefined;
    return select ? select(tab) : tab;
  });
}

export const useWindow = <T>(windowId: string | null | undefined, select: (w: BrowserWindow | undefined) => T): T =>
  useBrowser((s) => select(windowId ? s.windows[windowId] : undefined));

export const useSpace = <T>(spaceId: string | null | undefined, select: (p: Space | undefined) => T): T =>
  useBrowser((s) => select(spaceId ? s.spaces[spaceId] : undefined));

export const useGroup = <T>(groupId: string | null | undefined, select: (g: TabGroup | undefined) => T): T =>
  useBrowser((s) => select(groupId ? s.groups[groupId] : undefined));

export function useTabLive(tabId: string | undefined): TabLive;
export function useTabLive<T>(tabId: string | undefined, select: (live: TabLive) => T): T;
export function useTabLive<T>(tabId: string | undefined, select?: (live: TabLive) => T) {
  return useBrowser((s) => {
    const live = (tabId && s.live[tabId]) || IDLE_LIVE;
    return select ? select(live) : live;
  });
}

export const useFind = (tabId: string | undefined): FindState => useBrowser((s) => (tabId && s.find[tabId]) || CLOSED_FIND);

export function useWindowUi() {
  const id = useWindowId();
  return useBrowser((s) => s.windowUi[id] ?? DEFAULT_WINDOW_UI);
}

export const useSettings = <T>(select: (settings: Settings) => T): T => useBrowser((s) => select(s.settings));

export const useChosenSettings = (): readonly string[] => useBrowser((s) => s.settingsMeta.chosen);

export function useIsBookmarked(url: string): boolean {
  const id = useWindowId();
  return useBrowser((s) => isBookmarked(s, bookmarkSpaceId(s, s.windows[id]), url));
}

export const useAppDark = (): boolean => useBrowser((s) => s.ui.appDark);

export const useTabLayout = (windowId?: string | null): "sidebar" | "top" => useBrowser((s) => tabLayoutOf(s, windowId));

export const useDownloads = <T>(windowId: string, select: (downloads: BrowserState["downloads"]) => T): T => useBrowser((s) => select(downloadsIn(s, windowId)));
