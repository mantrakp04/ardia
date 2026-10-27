import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { plural, profileFor } from "../browser/model";
import type { Profile } from "../browser/types";
import type { Settings } from "../settings/settings";
import { useLookValue } from "../tabs/tabWatch";

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

export const useProfileLook = <T>(profileId: string, look: (profile: Profile | undefined, appDark: boolean, settings: Settings) => T): T => useLookValue(profileId, look);

export const useProfileLooks = <T>(pages: readonly { id: string }[], look: (profile: Profile | undefined, appDark: boolean, settings: Settings) => T): T[] =>
  useBrowser(useShallow((s) => pages.map((p) => look(s.profiles[p.id], s.ui.appDark, s.settings))));

export const useCreateProfileShareDefault = (windowId: string | null): string =>
  useBrowser((s) => (windowId && !s.windows[windowId]?.incognito ? s.windows[windowId]!.profileId : s.settings.defaultProfileId));

export const useProfileDataStats = (profileId: string): string =>
  useBrowser((s) => {
    const roots = s.bookmarks.roots[profileId];
    let bookmarks = 0;
    const walk = (id: string) => {
      const n = s.bookmarks.nodes[id];
      if (n?.kind === "url") bookmarks++;
      if (n?.kind === "folder") n.children.forEach(walk);
    };
    if (roots) [roots.bar, roots.other].forEach(walk);
    return `${plural((s.history[profileId] ?? []).length, "page")} in history · ${plural(bookmarks, "bookmark")}`;
  });
