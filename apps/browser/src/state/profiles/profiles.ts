import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { engineBookmarkRoots, ensureRoots, removeBookmarkTree } from "../bookmarks/bookmarks";
import { engineProfile, incognitoOriginal, newId, viewTabIds, without } from "../browser/model";
import { DEFAULT_PROFILE_ID } from "../settings/settings";
import { activated, apply, removeTabs, withNewTab } from "../tabs/tabs";
import type { Profile, ProfileColor } from "../browser/types";

export type ProfilesSlice = {
  profiles: Record<string, Profile>;
  profileOrder: string[];
  orphanedProfileData: string[];

  createProfile(options: { name: string; color?: ProfileColor; icon?: string | null; shareWith?: string | null }): string;
  updateProfile(id: string, patch: Partial<Pick<Profile, "name" | "icon" | "pinnedCollapsed">>): void;
  setProfileLook(id: string, look: Partial<Pick<Profile, "color" | "theme">>): void;
  deleteProfile(id: string): void;
  reorderProfiles(ids: string[]): void;
  setDefaultProfile(id: string): void;
  profileDataDeleted(engineId: string): void;
};

export const DEFAULT_PROFILE: Profile = { id: DEFAULT_PROFILE_ID, name: "Personal", color: "plum", icon: null, createdAt: 0 };

const COLORS: ProfileColor[] = ["blue", "green", "orange", "purple", "red", "yellow", "pink"];

export const unusedProfileColor = (profiles: Record<string, Profile>): ProfileColor =>
  COLORS.find((c) => !Object.values(profiles).some((p) => p.color === c)) ?? "blue";

const dataIdOf = (profile: Profile) => profile.dataId ?? profile.id;

export function dataGroups(s: Pick<BrowserState, "profiles" | "profileOrder">): { dataId: string; profileIds: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const id of s.profileOrder) {
    const p = s.profiles[id];
    if (!p) continue;
    const key = dataIdOf(p);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return [...groups].map(([dataId, profileIds]) => ({ dataId, profileIds }));
}

export function sharingProfiles(s: Pick<BrowserState, "profiles" | "profileOrder">, id: string): string[] {
  const p = s.profiles[id];
  if (!p) return [];
  return s.profileOrder.filter((other) => other !== id && s.profiles[other] && dataIdOf(s.profiles[other]!) === dataIdOf(p));
}

export const createProfilesSlice: StateCreator<BrowserState, [], [], ProfilesSlice> = (set, get) => {
  return {
    profiles: { [DEFAULT_PROFILE.id]: DEFAULT_PROFILE },
    profileOrder: [DEFAULT_PROFILE.id],
    orphanedProfileData: [],

    createProfile({ name, color, icon = null, shareWith }) {
      const s = get();
      const source = shareWith ? s.profiles[shareWith] : undefined;
      const profile: Profile = {
        id: newId("p"),
        name: name.trim() || `Profile ${s.profileOrder.length + 1}`,
        color: color ?? unusedProfileColor(s.profiles),
        icon,
        createdAt: Date.now(),
        ...(source ? { dataId: dataIdOf(source) } : {}),
      };
      const profiles = { ...s.profiles, [profile.id]: profile };
      const bookmarks = ensureRoots(s.bookmarks, engineProfile({ profiles }, profile.id))[0];
      set({ profiles, profileOrder: [...s.profileOrder, profile.id], bookmarks });
      return profile.id;
    },

    updateProfile(id, patch) {
      set((s) => (s.profiles[id] ? { profiles: { ...s.profiles, [id]: { ...s.profiles[id]!, ...patch } } } : {}));
    },

    setProfileLook(id, look) {
      set((s) => (s.profiles[id] ? { profiles: { ...s.profiles, [id]: { ...s.profiles[id]!, ...look } } } : {}));
    },

    deleteProfile(id) {
      if (!get().profiles[id] || get().profileOrder.length <= 1) return;
      for (const w of Object.values(get().windows)) if (w.kind === "private" && incognitoOriginal(w.profileId) === id) get().closeWindow(w.id);
      let s = get();
      const profileOrder = s.profileOrder.filter((p) => p !== id);
      const fallback = s.settings.defaultProfileId === id ? profileOrder[0]! : s.settings.defaultProfileId;
      const settings = {
        ...s.settings,
        defaultProfileId: s.settings.defaultProfileId === id ? fallback : s.settings.defaultProfileId,
        neverTranslateSites: without(s.settings.neverTranslateSites, [id]),
      };
      const engine = engineProfile(s, id);
      const engineLeft = !profileOrder.some((p) => engineProfile(s, p) === engine);
      const orphaned = !engineLeft || s.orphanedProfileData.includes(engine) ? s.orphanedProfileData : [...s.orphanedProfileData, engine];

      for (const w of Object.values(s.windows)) {
        if (w.profileId !== id) continue;
        const other = w.tabIds.find((t) => s.tabs[t]?.profileId !== id);
        if (other) s = apply(s, activated(s, w.activeTabIds[s.tabs[other]!.profileId] ?? other));
        else {
          const [next, tab] = withNewTab(s, w.id, { profileId: fallback, background: true });
          s = apply(next, activated(next, tab));
        }
      }
      s = removeTabs(
        s,
        Object.values(s.tabs).filter((t) => t.profileId === id).map((t) => t.id),
        false,
      );
      const windows = { ...s.windows };
      for (const w of Object.values(windows)) {
        if (w.activeTabIds[id]) windows[w.id] = { ...w, activeTabIds: without(w.activeTabIds, [id]) };
      }
      const roots = engineLeft ? engineBookmarkRoots(s.bookmarks, engine) : null;
      set({
        ...s,
        windows,
        profiles: without(s.profiles, [id]),
        profileOrder,
        orphanedProfileData: orphaned,
        settings,
        history: engineLeft ? without(s.history, [engine]) : s.history,
        bookmarks: roots ? removeBookmarkTree(s.bookmarks, [roots.bar, roots.other]) : s.bookmarks,
        bookmarksReady: engineLeft ? without(s.bookmarksReady, [engine]) : s.bookmarksReady,
        groups: Object.fromEntries(Object.entries(s.groups).filter(([, g]) => g.profileId !== id)),
        closedTabs: s.closedTabs.filter((c) => c.tab.profileId !== id),
        cleanedTabs: s.cleanedTabs.filter((c) => c.tab.profileId !== id),
        closedGroups: s.closedGroups.filter((c) => c.tabs.every((t) => t.profileId !== id)),
        deletedGroups: s.deletedGroups.filter((c) => c.tabs.every((t) => t.profileId !== id)),
        closedWindows: s.closedWindows
          .map((c) => ({ ...c, tabs: c.tabs.filter((t) => t.profileId !== id) }))
          .filter((c) => c.tabs.length > 0),
        parkedPins: without(s.parkedPins, [id]),
      });
      for (const w of Object.values(get().windows)) {
        if (!viewTabIds(get(), w.id).length) get().newTab(w.id);
      }
    },

    reorderProfiles(ids) {
      set((s) => {
        const known = ids.filter((id) => s.profiles[id]);
        return { profileOrder: [...known, ...s.profileOrder.filter((id) => !known.includes(id))] };
      });
    },

    setDefaultProfile(id) {
      set((s) => (s.profiles[id] ? { settings: { ...s.settings, defaultProfileId: id } } : {}));
    },

    profileDataDeleted(engineId) {
      set((s) => (s.orphanedProfileData.includes(engineId) ? { orphanedProfileData: s.orphanedProfileData.filter((e) => e !== engineId) } : {}));
    },
  };
};
