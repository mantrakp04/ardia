import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { bookmarkProfileId, engineProfile, sidebarSideOf, tabLayoutOf } from "../browser/model";
import { sidebarEdgeOf, type SidebarEdge } from "./sidebarEdge";
import { bookmarkRoots } from "./bookmarks";
import { bookmarksShown } from "./visibility";
import type { Bookmarks } from "../browser/types";
import type { Settings } from "../settings/settings";

export const useBookmarks = <T>(select: (bookmarks: Bookmarks) => T): T => useBrowser((s) => select(s.bookmarks));

export const useBookmarkProfileId = (windowId: string): string => useBrowser((s) => bookmarkProfileId(s, s.windows[windowId]));

export const useBookmarkEngine = (windowId: string): string => useBrowser((s) => engineProfile(s, bookmarkProfileId(s, s.windows[windowId])));

export const useBookmarkRoots = (profileId: string) => useBrowser(useShallow((s) => bookmarkRoots(s, profileId)));

export const useBookmarksShown = (): boolean => useBrowser((s) => bookmarksShown(s.settings));

export const useBookmarksBarMode = (windowId: string): Settings["bookmarksBar"] =>
  useBrowser((s) => (s.windows[windowId]?.kind === "private" || !bookmarksShown(s.settings) ? "never" : s.settings.bookmarksBar));

export const useSidebarEdge = (windowId: string, width: number): SidebarEdge =>
  useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      return sidebarEdgeOf({ shown: !!w?.sidebarOpen && tabLayoutOf(s, w.id) !== "top", side: sidebarSideOf(s, windowId), sidebarWidth: width, windowWidth: w?.frame?.[2] });
    }),
  );

export const useTabBookmarkProfileId = (tabId: string): string =>
  useBrowser((s) => bookmarkProfileId(s, s.windows[s.tabs[tabId]?.windowId ?? ""]));
