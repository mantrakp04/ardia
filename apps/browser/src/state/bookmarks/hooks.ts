import { useBrowser } from "../browser/store";
import { bookmarkProfileId } from "../browser/model";
import type { Bookmarks } from "../browser/types";
import type { Settings } from "../settings/settings";

export const useBookmarks = <T>(select: (bookmarks: Bookmarks) => T): T => useBrowser((s) => select(s.bookmarks));

export const useBookmarkProfileId = (windowId: string): string => useBrowser((s) => bookmarkProfileId(s, s.windows[windowId]));

export const useBookmarksBarMode = (windowId: string): Settings["bookmarksBar"] =>
  useBrowser((s) => (s.windows[windowId]?.incognito ? "never" : s.settings.bookmarksBar));

export const useSidebarEdge = (windowId: string, width: number) =>
  useBrowser((s) => {
    const w = s.windows[windowId];
    return w?.sidebarOpen && (w.tabLayout ?? s.settings.tabLayout) !== "top" ? width : 0;
  });

export const useTabBookmarkProfileId = (tabId: string): string =>
  useBrowser((s) => bookmarkProfileId(s, s.windows[s.tabs[tabId]?.windowId ?? ""]));
