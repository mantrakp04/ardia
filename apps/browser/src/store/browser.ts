import { create, type StateCreator } from "zustand";
import { createBookmarksSlice, ensureRoots, type BookmarksSlice } from "./bookmarks";
import { changedIds } from "./changes";
import { createGroupsSlice, settleNesting, type GroupsSlice } from "./groups";
import { createHistorySlice, type HistorySlice } from "./history";
import { IDLE_LIVE, isIncognitoProfile, pinnedFirst } from "./model";
import { createOrganizeSlice, forgetClosedPrivateWindows, keptCleanedTabs, keptDeletedGroups, livePinTable, notePinChoices, type OrganizeSlice } from "./organize";
import { createPeekSlice, settlePeeks, type PeekSlice } from "./peek";
import { mirrorPins } from "./pinMirror";
import { settleSharedPins } from "./pinShare";
import { mirrorTabs, pagesIntoSplits, unshareTabs } from "./tabShare";
import { settleTileFolders } from "./tileFolders";
import { createProfilesSlice, DEFAULT_PROFILE, engineIdOf, type ProfilesSlice } from "./profiles";
import { createSettingsSlice, DEFAULT_SETTINGS, migrateSavedSettings, type SettingsSlice } from "./settings";
import { createSplitsSlice, sanitizeSplits, type SplitsSlice } from "./splits";
import { activated, apply, createTabsSlice, type TabsSlice } from "./tabs";
import { transactional } from "./transaction";
import type { BrowserWindow, Tab } from "./types";
import { createUiSlice, type UiSlice } from "./ui";
import { createWindowsSlice, type WindowsSlice } from "./windows";

export type BrowserState = ProfilesSlice &
  WindowsSlice &
  TabsSlice &
  GroupsSlice &
  OrganizeSlice &
  SplitsSlice &
  HistorySlice &
  BookmarksSlice &
  SettingsSlice &
  UiSlice &
  PeekSlice & {
    hydrate(data: HydrateData): void;
  };

export type HydrateData = Partial<
  Pick<
    BrowserState,
    | "profiles"
    | "profileOrder"
    | "orphanedProfileData"
    | "windows"
    | "windowOrder"
    | "tabs"
    | "groups"
    | "splits"
    | "closedTabs"
    | "closedWindows"
    | "parkedPins"
    | "pinChoices"
    | "pinSync"
    | "closedGroups"
    | "deletedGroups"
    | "cleanedTabs"
    | "history"
    | "bookmarks"
    | "downloads"
    | "settings"
  >
> & { focusedWindowId?: string | null; lastProfileId?: string | null };

let batch = (update: () => void) => update();
export function setStoreBatching(batchedUpdates: (update: () => void) => void) {
  batch = batchedUpdates;
}
export const batchStoreUpdates = (update: () => void) => batch(update);

const batched =
  <T,>(creator: StateCreator<T>): StateCreator<T> =>
  (set, get, api) => {
    const batchedSet = ((...args: Parameters<typeof set>) => batch(() => (set as (...a: typeof args) => void)(...args))) as typeof set;
    api.setState = batchedSet;
    return creator(batchedSet, get, api);
  };

const pageMoved = (s: BrowserState, prev: BrowserState) => {
  if (s.tabs !== prev.tabs) for (const id of changedIds(s.tabs, prev.tabs)) if (s.tabs[id]?.url !== prev.tabs[id]?.url) return true;
  if (s.live !== prev.live) for (const id of changedIds(s.live, prev.live)) if (!!s.live[id]?.isLoading !== !!prev.live[id]?.isLoading) return true;
  return false;
};
const transactions = transactional<BrowserState>(pageMoved);
export const storeTransaction = transactions.transaction;

export const useBrowser = create<BrowserState>()(transactions.middleware(batched((...a) => ({
  ...createProfilesSlice(...a),
  ...createWindowsSlice(...a),
  ...createTabsSlice(...a),
  ...createGroupsSlice(...a),
  ...createOrganizeSlice(...a),
  ...createSplitsSlice(...a),
  ...createHistorySlice(...a),
  ...createBookmarksSlice(...a),
  ...createSettingsSlice(...a),
  ...createUiSlice(...a),
  ...createPeekSlice(...a),

  hydrate(data) {
    const [set, get] = a;
    const s = get();
    const profiles = data.profiles && Object.keys(data.profiles).length ? data.profiles : { [DEFAULT_PROFILE.id]: DEFAULT_PROFILE };
    const profileOrder = [
      ...(data.profileOrder ?? []).filter((id) => profiles[id]),
      ...Object.keys(profiles).filter((id) => !data.profileOrder?.includes(id)),
    ];
    const saved = migrateSavedSettings(data.settings);
    const legacy = saved && !saved.chosen ? Object.keys(saved) : null;
    const settings = { ...DEFAULT_SETTINGS, ...saved, chosen: legacy ?? saved?.chosen ?? [], inferred: legacy ?? saved?.inferred ?? [] };
    if (!profiles[settings.defaultProfileId]) settings.defaultProfileId = profileOrder[0]!;

    notePinChoices(data.pinChoices ?? {});
    const rawWindows = data.windows ?? {};
    const profileOk = (p: string) => !!profiles[p] || isIncognitoProfile(p);
    const tabs: Record<string, Tab> = {};
    for (const t of Object.values(data.tabs ?? {})) {
      if (!rawWindows[t.windowId] || !profileOk(t.profileId)) continue;
      const { adoptId: _, pageIn: _held, ...rest } = t;
      const { pinnedAsRow, tileFolder, ...kept } = rest;
      tabs[t.id] = {
        ...kept,
        ...(pinnedAsRow && kept.pinned ? { pinnedAsRow } : {}),
        ...(tileFolder && kept.pinned && !pinnedAsRow ? { tileFolder } : {}),
        navigation: null,
        pinnedUrl: kept.pinnedUrl ?? (kept.pinned ? kept.url || null : null),
      };
    }
    const windows: Record<string, BrowserWindow> = {};
    for (const w of Object.values(rawWindows)) {
      const tabIds = pinnedFirst(w.tabIds.filter((id) => tabs[id]?.windowId === w.id), tabs, data.groups ?? {});
      if (!tabIds.length) continue;
      const activeTabIds = Object.fromEntries(Object.entries(w.activeTabIds).filter(([p, id]) => tabs[id]?.profileId === p));
      const profileId = tabIds.some((id) => tabs[id]!.profileId === w.profileId) ? w.profileId : tabs[tabIds[0]!]!.profileId;
      activeTabIds[profileId] ??= tabIds.find((id) => tabs[id]!.profileId === profileId)!;
      windows[w.id] = { ...w, tabIds, profileId, activeTabIds };
    }
    for (const t of Object.values(tabs)) if (!windows[t.windowId]) delete tabs[t.id];
    const windowOrder = [...(data.windowOrder ?? []).filter((id) => windows[id]), ...Object.keys(windows).filter((id) => !data.windowOrder?.includes(id))];
    const inWindow = (id: string, windowId: string) => tabs[id]?.windowId === windowId;
    const groups = Object.fromEntries(
      Object.values(data.groups ?? {})
        .map((g) => ({ ...g, tabIds: g.tabIds.filter((id) => inWindow(id, g.windowId)) }))
        .filter((g) => g.tabIds.length)
        .map((g) => [g.id, g]),
    );
    const splits = sanitizeSplits(data.splits ?? {}, tabs);
    let bookmarks = data.bookmarks ?? s.bookmarks;
    for (const id of profileOrder) bookmarks = ensureRoots(bookmarks, id)[0];
    const focused = data.focusedWindowId && windows[data.focusedWindowId] ? data.focusedWindowId : (windowOrder.at(-1) ?? null);

    const engines = new Set(Object.values(profiles).map(engineIdOf));
    let next: BrowserState = {
      ...s,
      profiles,
      profileOrder,
      orphanedProfileData: (data.orphanedProfileData ?? []).filter((e) => !engines.has(e)),
      settings,
      windows,
      windowOrder,
      tabs,
      live: Object.fromEntries(Object.keys(tabs).map((id) => [id, IDLE_LIVE])),
      groups,
      splits,
      closedTabs: data.closedTabs ?? [],
      closedWindows: data.closedWindows ?? [],
      parkedPins: Object.fromEntries(Object.entries(data.parkedPins ?? {}).filter(([p]) => profiles[p])),
      pinChoices: Object.fromEntries(Object.entries(data.pinChoices ?? {}).filter(([p]) => profiles[p])),
      pinSync: Object.fromEntries(Object.entries(data.pinSync ?? {}).filter(([p]) => profiles[p])),
      closedGroups: data.closedGroups ?? [],
      deletedGroups: keptDeletedGroups(data.deletedGroups ?? []),
      cleanedTabs: keptCleanedTabs((data.cleanedTabs ?? []).filter((c) => !isIncognitoProfile(c.tab.profileId))),
      privateCleanedTabs: {},
      privateSiteMutes: {},
      selection: {},
      history: Object.fromEntries(Object.entries(data.history ?? {}).filter(([p]) => profiles[p])),
      historyReady: Object.fromEntries(Object.keys(data.history ?? {}).filter((p) => profiles[p]).map((p) => [p, true as const])),
      bookmarks,
      bookmarksReady: Object.fromEntries(Object.keys(data.bookmarks?.roots ?? {}).filter((p) => profiles[p]).map((p) => [p, true as const])),
      downloads: data.downloads ?? [],
      windowUi: {},
      peeks: {},
      find: {},
      ui: {
        ...s.ui,
        focusedWindowId: focused,
        focusOrder: focused ? [focused, ...windowOrder.filter((id) => id !== focused).reverse()] : [],
        lastProfileId: data.lastProfileId && profiles[data.lastProfileId] ? data.lastProfileId : null,
      },
    };
    for (const id of next.ui.focusOrder) next = apply(next, activated(next, windows[id]!.activeTabIds[windows[id]!.profileId]!));
    set(next);
  },
}))));

useBrowser.subscribe((s, prev) => {
  const patch = s.windows !== prev.windows && forgetClosedPrivateWindows(s);
  if (patch) useBrowser.setState(patch);
});

useBrowser.subscribe((s, prev) => {
  if (s.groups === prev.groups && Object.values(s.windows).every((w) => w.tabIds === prev.windows[w.id]?.tabIds)) return;
  const settled = settleNesting(s);
  if (settled) useBrowser.setState(settled);
});

useBrowser.subscribe((s, prev) => {
  if (s.pinChoices === prev.pinChoices && s.pinSync === prev.pinSync && s.tabs === prev.tabs && s.groups === prev.groups && s.parkedPins === prev.parkedPins && s.profiles === prev.profiles) return;
  const pinChoices = livePinTable(s.pinChoices, s);
  const pinSync = livePinTable(s.pinSync, s);
  if (pinChoices !== s.pinChoices || pinSync !== s.pinSync) useBrowser.setState({ pinChoices, pinSync });
});

useBrowser.subscribe((s, prev) => {
  const next = settlePeeks(s, prev);
  if (next) useBrowser.setState(next);
});

let mirroring = 0;
useBrowser.subscribe((s, prev) => {
  if (mirroring > 3) return;
  const unshared = unshareTabs(s, prev) ?? pagesIntoSplits(s, prev);
  const base = unshared ?? s;
  const shared = settleSharedPins(base, prev) ?? unshared;
  const settled = settleTileFolders(shared ?? base, prev) ?? shared;
  const pinned = mirrorPins(settled ?? base, prev) ?? settled;
  const next = mirrorTabs(pinned ?? base, prev) ?? pinned;
  if (!next) return;
  mirroring++;
  try {
    useBrowser.setState(next);
  } finally {
    mirroring--;
  }
});

export type { CreateWindowOptions } from "./windows";
