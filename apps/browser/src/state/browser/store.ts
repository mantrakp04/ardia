import { create, type StateCreator } from "zustand";
import { setHeldReportsTransaction } from "../../platform/nativeEvents";
import { createBookmarksSlice, ensureRoots, type BookmarksSlice } from "../bookmarks/bookmarks";
import { changedIds } from "./changes";
import { createGroupsSlice, type GroupsSlice } from "../groups/groups";
import { createHistorySlice, type HistorySlice } from "../history/history";
import { engineProfile, IDLE_LIVE, isIncognitoProfile } from "./model";
import { createOrganizeSlice, type OrganizeSlice } from "../pins/organize";
import { createMuteSlice, type MuteSlice } from "../tabs/mute";
import { createCleanUpSlice, type CleanUpSlice } from "../pins/tabCleanup";
import { keptCleanedTabs, keptDeletedGroups } from "../pins/closedTabs";
import { notePinChoices } from "../pins/pinChoices";
import { createPeekSlice, type PeekSlice } from "../peek/peek";
import { pinHome } from "../pins/pinHomes";
import { createProfilesSlice, DEFAULT_PROFILE, type ProfilesSlice } from "../profiles/profiles";
import { engineProfiles } from "../profiles/engineProfiles";
import { createSettingsSlice, parseSettings, parseSettingsMeta, type SettingsSlice } from "../settings/settings";
import { createSplitsSlice, sanitizeSplits, type SplitsSlice } from "../splits/splits";
import { activated, apply } from "../tabs/tabs";
import { createTabsSlice, type TabsSlice } from "../tabs/tabsSlice";
import { settle, SettleDidNotConverge } from "./settle";
import { transactional } from "./transaction";
import type { BrowserWindow, Tab } from "./types";
import { createUiSlice, type UiSlice } from "../windows/ui";
import { createDownloadsSlice, type DownloadsSlice } from "../downloads/downloadsSlice";
import { createWindowsSlice, type WindowsSlice } from "../windows/windows";
import { orderSections } from "../groups/groups";

export type BrowserState = ProfilesSlice &
  WindowsSlice &
  TabsSlice &
  GroupsSlice &
  OrganizeSlice &
  MuteSlice &
  CleanUpSlice &
  SplitsSlice &
  HistorySlice &
  BookmarksSlice &
  SettingsSlice &
  UiSlice &
  DownloadsSlice &
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
    | "downloads"
    | "settings"
    | "settingsMeta"
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
const reportsUnsettled = !__DEV__ && !(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_TEST_CONTEXT;
const settled = (s: BrowserState, prev: BrowserState) => {
  try {
    return settle(s, prev);
  } catch (error) {
    if (!(error instanceof SettleDidNotConverge) || !reportsUnsettled) throw error;
    console.error(error);
    return error.settled;
  }
};
const transactions = transactional<BrowserState>(pageMoved, settled);
export const storeTransaction = transactions.transaction;
setHeldReportsTransaction(storeTransaction);

export const useBrowser = create<BrowserState>()(transactions.middleware(batched((...a) => ({
  ...createProfilesSlice(...a),
  ...createWindowsSlice(...a),
  ...createTabsSlice(...a),
  ...createGroupsSlice(...a),
  ...createOrganizeSlice(...a),
  ...createMuteSlice(...a),
  ...createCleanUpSlice(...a),
  ...createSplitsSlice(...a),
  ...createHistorySlice(...a),
  ...createBookmarksSlice(...a),
  ...createSettingsSlice(...a),
  ...createUiSlice(...a),
  ...createDownloadsSlice(...a),
  ...createPeekSlice(...a),

  hydrate(data) {
    const [set, get] = a;
    const s = get();
    const profiles = data.profiles && Object.keys(data.profiles).length ? data.profiles : { [DEFAULT_PROFILE.id]: DEFAULT_PROFILE };
    const profileOrder = [
      ...(data.profileOrder ?? []).filter((id) => profiles[id]),
      ...Object.keys(profiles).filter((id) => !data.profileOrder?.includes(id)),
    ];
    const settings = parseSettings(data.settings);
    if (!profiles[settings.defaultProfileId]) settings.defaultProfileId = profileOrder[0]!;

    notePinChoices(data.pinChoices ?? {});
    const rawWindows = data.windows ?? {};
    const profileOk = (p: string) => !!profiles[p] || isIncognitoProfile(p);
    const tabs: Record<string, Tab> = {};
    for (const t of Object.values(data.tabs ?? {})) {
      if (!rawWindows[t.windowId] || !profileOk(t.profileId)) continue;
      tabs[t.id] = { ...t, pinnedUrl: t.pinnedUrl ?? pinHome(t, !!t.pin) };
    }
    const windows: Record<string, BrowserWindow> = {};
    for (const w of Object.values(rawWindows)) {
      const tabIds = orderSections(w.tabIds.filter((id) => tabs[id]?.windowId === w.id), tabs, data.groups ?? {});
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
    let bookmarks = s.bookmarks;
    for (const engine of engineProfiles({ profiles })) bookmarks = ensureRoots(bookmarks, engine)[0];
    const focused = data.focusedWindowId && windows[data.focusedWindowId] ? data.focusedWindowId : (windowOrder.at(-1) ?? null);

    const engines = new Set(Object.keys(profiles).map((id) => engineProfile({ profiles }, id)));
    let next: BrowserState = {
      ...s,
      profiles,
      profileOrder,
      orphanedProfileData: (data.orphanedProfileData ?? []).filter((e) => !engines.has(e)),
      settings,
      settingsMeta: parseSettingsMeta(data.settingsMeta),
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
      selectionAnchors: {},
      history: {},
      bookmarks,
      bookmarksReady: {},
      downloads: data.downloads ?? [],
      windowUi: {},
      peeks: {},
      find: {},
      ui: {
        ...s.ui,
        focusOrder: focused ? [focused, ...windowOrder.filter((id) => id !== focused).reverse()] : [],
        lastProfileId: data.lastProfileId && profiles[data.lastProfileId] ? data.lastProfileId : null,
      },
    };
    for (const id of next.ui.focusOrder) next = apply(next, activated(next, windows[id]!.activeTabIds[windows[id]!.profileId]!));
    set(next);
  },
}))));

export type { CreateWindowOptions } from "../windows/windows";

type StoreActions = { [K in keyof BrowserState as BrowserState[K] extends (...args: never[]) => unknown ? K : never]: BrowserState[K] };

export const storeAction =
  <K extends keyof StoreActions>(name: K): StoreActions[K] =>
  ((...args: unknown[]) => (useBrowser.getState()[name] as (...a: unknown[]) => unknown)(...args)) as StoreActions[K];
