import { hasPage, loadedPage, withWake } from "../tabs/pageSession";
import { parkSpaceTopApps } from "../pins/topApps";
import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { ensureRoots } from "../bookmarks/bookmarks";
import { IDLE_LIVE, navigationTo, newId, setSharedDataIds, viewTabIds, without } from "../browser/model";
import { DEFAULT_SPACE_ID } from "../settings/settings";
import { activated, apply, removeTabs, withNewTab } from "../tabs/tabs";
import type { Space, ProfileColor } from "../browser/types";

export type SpacesSlice = {
  spaces: Record<string, Space>;
  spaceOrder: string[];
  orphanedProfileData: string[];

  createSpace(options: { name: string; color?: ProfileColor; icon?: string | null; profileId?: string }): string;
  updateSpace(id: string, patch: Partial<Pick<Space, "name" | "color" | "icon" | "theme" | "pinnedCollapsed">>): void;
  deleteSpace(id: string): void;
  assignSpaceProfile(id: string, profileId: string): void;
  reorderSpaces(ids: string[]): void;
  setDefaultSpace(id: string): void;
  spaceDataDeleted(engineId: string): void;
};

export const DEFAULT_SPACE: Space = { id: DEFAULT_SPACE_ID, name: "Personal", color: "plum", icon: null, createdAt: 0, profileId: "default" };

const COLORS: ProfileColor[] = ["blue", "green", "orange", "purple", "red", "yellow", "pink"];

export const unusedSpaceColor = (spaces: Record<string, Space>): ProfileColor =>
  COLORS.find((c) => !Object.values(spaces).some((p) => p.color === c)) ?? "blue";

const dataIdOf = (profile: Space) => profile.profileId ?? profile.id;
export const engineIdOfSpace = (profile: Space) => (dataIdOf(profile) === DEFAULT_SPACE_ID ? "" : dataIdOf(profile));

export function dataGroups(s: Pick<BrowserState, "spaces" | "spaceOrder">): { profileId: string; spaceIds: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const id of s.spaceOrder) {
    const p = s.spaces[id];
    if (!p) continue;
    const key = dataIdOf(p);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return [...groups].map(([profileId, spaceIds]) => ({ profileId, spaceIds }));
}

export function sharingSpaces(s: Pick<BrowserState, "spaces" | "spaceOrder">, id: string): string[] {
  const p = s.spaces[id];
  if (!p) return [];
  return s.spaceOrder.filter((other) => other !== id && s.spaces[other] && dataIdOf(s.spaces[other]!) === dataIdOf(p));
}

export function rememberSpaceEngines(s: BrowserState, prev: BrowserState): void {
  if (s.spaces !== prev.spaces || s.profiles !== prev.profiles || s.windows !== prev.windows) {
    setSharedDataIds(Object.fromEntries([
      ...Object.values(s.spaces).map((space) => [space.id, s.profiles[space.profileId]?.engineId ?? space.profileId]),
      ...Object.values(s.windows).filter((w) => (w.kind === "private") && w.incognitoEngineId !== undefined).map((w) => [w.spaceId, w.incognitoEngineId!]),
    ]));
  }
}

export const createSpacesSlice: StateCreator<BrowserState, [], [], SpacesSlice> = (set, get) => {

  return {
    spaces: { [DEFAULT_SPACE.id]: DEFAULT_SPACE },
    spaceOrder: [DEFAULT_SPACE.id],
    orphanedProfileData: [],

    createSpace({ name, color, icon = null, profileId }) {
      const s = get();
      const assigned = profileId ?? s.spaces[s.settings.defaultSpaceId]?.profileId ?? Object.keys(s.profiles)[0]!;
      if (!s.profiles[assigned]) throw new Error("That profile no longer exists.");
      const profile: Space = {
        id: newId("profile"), name: name.trim() || `Space ${s.spaceOrder.length + 1}`,
        color: color ?? unusedSpaceColor(s.spaces), icon, createdAt: Date.now(), profileId: assigned,
      };
      set({ spaces: { ...s.spaces, [profile.id]: profile }, spaceOrder: [...s.spaceOrder, profile.id], bookmarks: ensureRoots(s.bookmarks, s.profiles[assigned]!.engineId)[0] });
      return profile.id;
    },

    assignSpaceProfile(id, profileId) {
      let s = get();
      if (!s.spaces[id] || !s.profiles[profileId] || s.spaces[id]!.profileId === profileId) return;
      s = parkSpaceTopApps(s, id);
      const tabs = Object.fromEntries(Object.entries(s.tabs).map(([key, tab]) => [key, tab.spaceId === id
        ? { ...tab, page: hasPage(tab) ? loadedPage(navigationTo(tab.url)) : withWake(tab.page, undefined) }
        : tab]));
      set({
        ...s,
        spaces: { ...s.spaces, [id]: { ...s.spaces[id]!, profileId } }, tabs,
        live: Object.fromEntries(Object.entries(s.live).map(([key, live]) => [key, tabs[key]?.spaceId === id ? { ...IDLE_LIVE, isLoading: !!tabs[key] && hasPage(tabs[key]!) } : live])),
        bookmarks: ensureRoots(s.bookmarks, s.profiles[profileId]!.engineId)[0],
      });
      for (const w of Object.values(get().windows)) if (!(w.kind === "private") && w.spaceId === id && !viewTabIds(get(), w.id).length) get().newTab(w.id);
    },

    updateSpace(id, patch) {
      set((s) => (s.spaces[id] ? { spaces: { ...s.spaces, [id]: { ...s.spaces[id]!, ...patch } } } : {}));
    },

    deleteSpace(id) {
      if (!get().spaces[id] || get().spaceOrder.length <= 1 || get().settings.defaultSpaceId === id) return;
      for (const w of Object.values(get().windows)) if ((w.kind === "private") && w.originalSpaceId === id) get().closeWindow(w.id);
      let s = parkSpaceTopApps(get(), id);
      const spaceOrder = s.spaceOrder.filter((p) => p !== id);
      const fallback = s.settings.defaultSpaceId === id ? spaceOrder[0]! : s.settings.defaultSpaceId;
      const settings = {
        ...s.settings,
        defaultSpaceId: s.settings.defaultSpaceId === id ? fallback : s.settings.defaultSpaceId,
        neverTranslateSites: without(s.settings.neverTranslateSites ?? {}, [id]),
      };

      for (const w of Object.values(s.windows)) {
        if (w.spaceId !== id) continue;
        const other = w.tabIds.find((t) => s.tabs[t]?.spaceId !== id);
        if (other) s = apply(s, activated(s, w.activeTabIds[s.tabs[other]!.spaceId] ?? other));
        else {
          const [next, tab] = withNewTab(s, w.id, { spaceId: fallback, background: true });
          s = apply(next, activated(next, tab));
        }
      }
      s = removeTabs(
        s,
        Object.values(s.tabs).filter((t) => t.spaceId === id).map((t) => t.id),
        false,
      );
      const windows = { ...s.windows };
      for (const w of Object.values(windows)) {
        if (w.activeTabIds[id]) windows[w.id] = { ...w, activeTabIds: without(w.activeTabIds, [id]) };
      }
      set({
        ...s,
        windows,
        spaces: without(s.spaces, [id]),
        spaceOrder,
        settings,
        groups: Object.fromEntries(Object.entries(s.groups).filter(([, g]) => g.spaceId !== id)),
        closedTabs: s.closedTabs.filter((c) => c.tab.spaceId !== id),
        cleanedTabs: s.cleanedTabs.filter((c) => c.tab.spaceId !== id),
        closedGroups: s.closedGroups.filter((c) => c.tabs.every((t) => t.spaceId !== id)),
        deletedGroups: s.deletedGroups.filter((c) => c.tabs.every((t) => t.spaceId !== id)),
        closedWindows: s.closedWindows
          .map((c) => ({ ...c, tabs: c.tabs.filter((t) => t.spaceId !== id) }))
          .filter((c) => c.tabs.length > 0),
        parkedPins: without(s.parkedPins, [id]),
      });
      for (const w of Object.values(get().windows)) {
        if (!viewTabIds(get(), w.id).length) get().newTab(w.id);
      }
    },

    reorderSpaces(ids) {
      set((s) => {
        const known = ids.filter((id) => s.spaces[id]);
        return { spaceOrder: [...known, ...s.spaceOrder.filter((id) => !known.includes(id))] };
      });
    },

    setDefaultSpace(id) {
      set((s) => (s.spaces[id] ? { settings: { ...s.settings, defaultSpaceId: id } } : {}));
    },

    spaceDataDeleted(engineId) {
      set((s) => (s.orphanedProfileData.includes(engineId) ? { orphanedProfileData: s.orphanedProfileData.filter((e) => e !== engineId) } : {}));
    },
  };
};
