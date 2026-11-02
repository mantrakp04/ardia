import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { plural, profileFor } from "../browser/model";
import type { Profile } from "../browser/types";
import { bookmarkRoots } from "../bookmarks/bookmarks";
import { historyOf } from "../history/history";
import type { Settings } from "../settings/settings";
import { useLookValue } from "../tabs/tabWatch";
import { useBasePaletteValue } from "../config/hooks";
import type { BasePalette } from "../../lib/themeFile";

export function useProfileRecords(): Record<string, Profile>;
export function useProfileRecords<T>(select: (profiles: Record<string, Profile>) => T): T;
export function useProfileRecords<T>(select?: (profiles: Record<string, Profile>) => T) {
  return useBrowser((s) => (select ? select(s.profiles) : s.profiles));
}

export function useProfileOrder(): string[];
export function useProfileOrder<T>(select: (order: string[]) => T): T;
export function useProfileOrder<T>(select?: (order: string[]) => T) {
  return useBrowser((s) => (select ? select(s.profileOrder) : s.profileOrder));
}

export const useProfileName = (profileId: string): string => useBrowser((s) => profileFor(s, profileId).name);

export const useWindowProfileValue = <T>(windowId: string, select: (profile: Profile | undefined) => T): T =>
  useBrowser((s) => select(s.profiles[s.windows[windowId]?.profileId ?? ""]));

type ProfileLook<T> = (profile: Profile | undefined, appDark: boolean, settings: Settings, palette: BasePalette | null) => T;

export const useProfileLook = <T>(profileId: string, look: ProfileLook<T>): T => useLookValue(profileId, look);

export function useProfileLooks<T>(pages: readonly { id: string }[], look: ProfileLook<T>): T[] {
  const palette = useBasePaletteValue();
  return useBrowser(useShallow((s) => pages.map((p) => look(s.profiles[p.id], s.ui.appDark, s.settings, palette))));
}

export const useCreateProfileShareDefault = (windowId: string | null): string =>
  useBrowser((s) => (windowId && s.windows[windowId]?.kind !== "private" ? s.windows[windowId]!.profileId : s.settings.defaultProfileId));

export const useProfileDataStats = (profileId: string): string =>
  useBrowser((s) => {
    const roots = bookmarkRoots(s, profileId);
    let bookmarks = 0;
    const walk = (id: string) => {
      const n = s.bookmarks.nodes[id];
      if (n?.kind === "url") bookmarks++;
      if (n?.kind === "folder") n.children.forEach(walk);
    };
    if (roots) [roots.bar, roots.other].forEach(walk);
    return `${plural(historyOf(s, profileId).length, "page")} in history · ${plural(bookmarks, "bookmark")}`;
  });
