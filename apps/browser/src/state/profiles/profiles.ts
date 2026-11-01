import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { engineBookmarkRoots, removeBookmarkTree } from "../bookmarks/bookmarks";
import type { Profile, TopApp, Tab } from "../browser/types";
import { newId, without } from "../browser/model";

export const DEFAULT_PROFILE: Profile = { id: "default", name: "Personal", icon: null, engineId: "", createdAt: 0 };

export type ProfilesSlice = {
  profiles: Record<string, Profile>;
  topApps: Record<string, TopApp[]>;
  parkedTopApps: Record<string, Tab[]>;
  createProfile(options: { name: string; icon?: string | null }): string;
  updateProfile(id: string, patch: Partial<Pick<Profile, "name" | "icon">>): void;
  deleteProfile(id: string, replacementId?: string): void;
};

export const sortedProfiles = (profiles: Record<string, Profile>): Profile[] =>
  Object.values(profiles).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export const createProfilesSlice: StateCreator<BrowserState, [], [], ProfilesSlice> = (set, get) => ({
  profiles: { [DEFAULT_PROFILE.id]: DEFAULT_PROFILE },
  topApps: {},
  parkedTopApps: {},
  createProfile({ name, icon = null }) {
    const id = newId("profile");
    set((s) => ({ profiles: { ...s.profiles, [id]: { id, name: name.trim() || "New Profile", icon, engineId: id, createdAt: Date.now() } } }));
    return id;
  },
  updateProfile(id, patch) {
    set((s) => s.profiles[id] ? { profiles: { ...s.profiles, [id]: { ...s.profiles[id]!, ...patch } } } : {});
  },
  deleteProfile(id, replacementId) {
    let s = get();
    const profile = s.profiles[id];
    if (!profile || Object.keys(s.profiles).length <= 1 || Object.values(s.windows).some((window) => (window.kind === "private") && window.incognitoEngineId === profile.engineId)) return;
    const spaces = Object.values(s.spaces).filter((space) => space.profileId === id);
    if (spaces.length && (!replacementId || replacementId === id || !s.profiles[replacementId])) return;
    for (const space of spaces) get().assignSpaceProfile(space.id, replacementId!);
    s = get();
    const roots = engineBookmarkRoots(s.bookmarks, profile.engineId);
    set({ history: without(s.history, [profile.engineId]), bookmarks: roots ? removeBookmarkTree(s.bookmarks, [roots.bar, roots.other]) : s.bookmarks, bookmarksReady: without(s.bookmarksReady, [profile.engineId]), profiles: without(s.profiles, [id]), topApps: without(s.topApps, [id]), parkedTopApps: without(s.parkedTopApps, [id]), orphanedProfileData: [...new Set([...s.orphanedProfileData, profile.engineId])] });
  },
});
