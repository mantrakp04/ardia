import { bookmarkRoots } from "../bookmarks/bookmarks";
import { historyOf } from "../history/history";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { plural, spaceFor } from "../browser/model";
import type { Space } from "../browser/types";
import type { Settings } from "../settings/settings";
import { useLookValue } from "../tabs/tabWatch";

export function useSpaceRecords(): Record<string, Space>;
export function useSpaceRecords<T>(select: (spaces: Record<string, Space>) => T): T;
export function useSpaceRecords<T>(select?: (spaces: Record<string, Space>) => T) {
  return useBrowser((s) => (select ? select(s.spaces) : s.spaces));
}

export function useSpaceOrder(): string[];
export function useSpaceOrder<T>(select: (order: string[]) => T): T;
export function useSpaceOrder<T>(select?: (order: string[]) => T) {
  return useBrowser((s) => (select ? select(s.spaceOrder) : s.spaceOrder));
}

export const useSpaceName = (spaceId: string): string => useBrowser((s) => spaceFor(s, spaceId).name);

export const useWindowSpaceValue = <T>(windowId: string, select: (profile: Space | undefined) => T): T =>
  useBrowser((s) => select(s.spaces[s.windows[windowId]?.spaceId ?? ""]));

export const useProfileLook = <T>(spaceId: string, look: (profile: Space | undefined, appDark: boolean, settings: Settings) => T): T => useLookValue(spaceId, look);

export const useProfileLooks = <T>(pages: readonly { id: string }[], look: (profile: Space | undefined, appDark: boolean, settings: Settings) => T): T[] =>
  useBrowser(useShallow((s) => pages.map((p) => look(s.spaces[p.id], s.ui.appDark, s.settings))));

export const useCreateSpaceShareDefault = (windowId: string | null): string =>
  useBrowser((s) => (windowId && !(s.windows[windowId]?.kind === "private") ? s.windows[windowId]!.spaceId : s.settings.defaultSpaceId));

export const useSpaceDataStats = (spaceId: string): string =>
  useBrowser((s) => {
    const roots = bookmarkRoots(s, spaceId);
    let bookmarks = 0;
    const walk = (id: string) => {
      const n = s.bookmarks.nodes[id];
      if (n?.kind === "url") bookmarks++;
      if (n?.kind === "folder") n.children.forEach(walk);
    };
    if (roots) [roots.bar, roots.other].forEach(walk);
    return `${plural(historyOf(s, spaceId).length, "page")} in history · ${plural(bookmarks, "bookmark")}`;
  });
