import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { bookmarkProfileId, engineProfile, tabLayoutOf } from "../browser/model";
import { bookmarkRoots } from "./bookmarks";
import type { Bookmarks } from "../browser/types";
import type { Settings } from "../settings/settings";

export const useBookmarks = <T>(select: (bookmarks: Bookmarks) => T): T => useBrowser((s) => select(s.bookmarks));

export const useBookmarkProfileId = (windowId: string): string => useBrowser((s) => bookmarkProfileId(s, s.windows[windowId]));

export const useBookmarkEngine = (windowId: string): string => useBrowser((s) => engineProfile(s, bookmarkProfileId(s, s.windows[windowId])));

export const useBookmarkRoots = (profileId: string) => useBrowser(useShallow((s) => bookmarkRoots(s, profileId)));

export const useBookmarksBarMode = (windowId: string): Settings["bookmarksBar"] =>
  useBrowser((s) => (s.windows[windowId]?.kind === "private" ? "never" : s.settings.bookmarksBar));

export const useSidebarEdge = (windowId: string, width: number) =>
  useBrowser((s) => {
    const w = s.windows[windowId];
    return w?.sidebarOpen && tabLayoutOf(s, w.id) !== "top" ? width : 0;
  });

export const useTabBookmarkProfileId = (tabId: string): string =>
  useBrowser((s) => bookmarkProfileId(s, s.windows[s.tabs[tabId]?.windowId ?? ""]));
