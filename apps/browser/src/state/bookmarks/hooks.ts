import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { bookmarkProfileId, engineProfile, tabLayoutOf } from "../browser/model";
import { bookmarkRoots } from "./bookmarks";
import type { Bookmarks } from "../browser/types";
import type { Settings } from "../settings/settings";
import { NO_SIDEBAR, type SidebarSpan } from "./barDrag";
import { sidebarSideOf, useCardAnchors } from "../windows/layout";

export const useBookmarks = <T>(select: (bookmarks: Bookmarks) => T): T => useBrowser((s) => select(s.bookmarks));

export const useBookmarkProfileId = (windowId: string): string => useBrowser((s) => bookmarkProfileId(s, s.windows[windowId]));

export const useBookmarkEngine = (windowId: string): string => useBrowser((s) => engineProfile(s, bookmarkProfileId(s, s.windows[windowId])));

export const useBookmarkRoots = (profileId: string) => useBrowser(useShallow((s) => bookmarkRoots(s, profileId)));

export const useBookmarksBarMode = (windowId: string): Settings["bookmarksBar"] =>
  useBrowser((s) => (s.windows[windowId]?.incognito ? "never" : s.settings.bookmarksBar));

export function useSidebarSpan(windowId: string, width: number): SidebarSpan {
  const shown = useBrowser((s) => {
    const w = s.windows[windowId];
    return !!w?.sidebarOpen && tabLayoutOf(s, w.id) !== "top";
  });
  const right = useBrowser((s) => sidebarSideOf(s, windowId) === "right");
  const cardEnd = useCardAnchors((a) => (a[windowId] ? a[windowId]!.left + a[windowId]!.width : Infinity));
  if (!shown) return NO_SIDEBAR;
  return right ? { from: cardEnd, to: Infinity } : { from: -Infinity, to: width };
}

export const useTabBookmarkProfileId = (tabId: string): string =>
  useBrowser((s) => bookmarkProfileId(s, s.windows[s.tabs[tabId]?.windowId ?? ""]));
