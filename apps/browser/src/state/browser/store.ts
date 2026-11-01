import { create, type StateCreator } from "zustand";
import { setHeldReportsTransaction } from "../../platform/nativeEvents";
import { createBookmarksSlice, ensureRoots, type BookmarksSlice } from "../bookmarks/bookmarks";
import { changedIds } from "./changes";
import { createGroupsSlice, type GroupsSlice } from "../groups/groups";
import { createHistorySlice, type HistorySlice } from "../history/history";
import { setSharedDataIds, IDLE_LIVE, isIncognitoSpace } from "./model";
import { createOrganizeSlice, type OrganizeSlice } from "../pins/organize";
import { createMuteSlice, type MuteSlice } from "../tabs/mute";
import { createCleanUpSlice, type CleanUpSlice } from "../pins/tabCleanup";
import { keptCleanedTabs, keptDeletedGroups } from "../pins/closedTabs";
import { notePinChoices } from "../pins/pinChoices";
import { createPeekSlice, type PeekSlice } from "../peek/peek";
import { pinHome } from "../pins/pinHomes";
import { createSpacesSlice, rememberSpaceEngines, DEFAULT_SPACE, type SpacesSlice } from "../spaces/spaces";
import { engineSpaces } from "../spaces/engineSpaces";
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

import { createProfilesSlice, DEFAULT_PROFILE, type ProfilesSlice } from "../profiles/profiles";

export type BrowserState = ProfilesSlice & SpacesSlice &
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
    | "topApps"
    | "parkedTopApps"
    | "spaces"
    | "spaceOrder"
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
> & { focusedWindowId?: string | null; lastSpaceId?: string | null };

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
    rememberSpaceEngines(s, prev);
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
  ...createSpacesSlice(...a),
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
    const rawSpaces = data.spaces && Object.keys(data.spaces).length ? data.spaces : { [DEFAULT_SPACE.id]: DEFAULT_SPACE };
    const spaces = Object.fromEntries(Object.entries(rawSpaces).map(([id, space]) => [id, { ...space, profileId: space.profileId ?? id }]));
    const profiles = { ...(data.profiles ?? {}) };
    for (const space of Object.values(spaces)) if (!profiles[space.profileId]) profiles[space.profileId] = {
      id: space.profileId, name: space.name, icon: space.icon, engineId: space.profileId === "default" ? "" : space.profileId, createdAt: space.createdAt,
    };
    if (!Object.keys(profiles).length) profiles[DEFAULT_PROFILE.id] = DEFAULT_PROFILE;
    setSharedDataIds(Object.fromEntries(Object.values(spaces).map((space) => [space.id, profiles[space.profileId]!.engineId])));
    const spaceOrder = [
      ...(data.spaceOrder ?? []).filter((id) => spaces[id]),
      ...Object.keys(spaces).filter((id) => !data.spaceOrder?.includes(id)),
    ];
    const settings = parseSettings(data.settings);
    if (!spaces[settings.defaultSpaceId]) settings.defaultSpaceId = spaceOrder[0]!;

    notePinChoices(data.pinChoices ?? {});
    const rawWindows = data.windows ?? {};
    const spaceOk = (p: string) => !!spaces[p] || isIncognitoSpace(p);
    const tabs: Record<string, Tab> = {};
    for (const t of Object.values(data.tabs ?? {})) {
      if (!rawWindows[t.windowId] || !spaceOk(t.spaceId)) continue;
      tabs[t.id] = { ...t, pinnedUrl: t.pinnedUrl ?? pinHome(t, !!t.pin) };
    }
    const windows: Record<string, BrowserWindow> = {};
    for (const w of Object.values(rawWindows)) {
      const tabIds = orderSections(w.tabIds.filter((id) => tabs[id]?.windowId === w.id), tabs, data.groups ?? {});
      if (!tabIds.length) continue;
      const activeTabIds = Object.fromEntries(Object.entries(w.activeTabIds).filter(([p, id]) => tabs[id]?.spaceId === p));
      const spaceId = tabIds.some((id) => tabs[id]!.spaceId === w.spaceId) ? w.spaceId : tabs[tabIds[0]!]!.spaceId;
      activeTabIds[spaceId] ??= tabIds.find((id) => tabs[id]!.spaceId === spaceId)!;
      windows[w.id] = { ...w, tabIds, spaceId, activeTabIds };
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
    for (const engine of engineSpaces({ profiles })) bookmarks = ensureRoots(bookmarks, engine)[0];
    const focused = data.focusedWindowId && windows[data.focusedWindowId] ? data.focusedWindowId : (windowOrder.at(-1) ?? null);

    const engines = new Set(Object.values(profiles).map((profile) => profile.engineId));
    let next: BrowserState = {
      ...s,
      profiles,
      topApps: data.topApps ?? {},
      parkedTopApps: data.parkedTopApps ?? {},
      spaces,
      spaceOrder,
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
      parkedPins: Object.fromEntries(Object.entries(data.parkedPins ?? {}).filter(([p]) => spaces[p])),
      pinChoices: Object.fromEntries(Object.entries(data.pinChoices ?? {}).filter(([p]) => spaces[p])),
      pinSync: Object.fromEntries(Object.entries(data.pinSync ?? {}).filter(([p]) => spaces[p])),
      closedGroups: data.closedGroups ?? [],
      deletedGroups: keptDeletedGroups(data.deletedGroups ?? []),
      cleanedTabs: keptCleanedTabs((data.cleanedTabs ?? []).filter((c) => !isIncognitoSpace(c.tab.spaceId))),
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
        lastSpaceId: data.lastSpaceId && spaces[data.lastSpaceId] ? data.lastSpaceId : null,
      },
    };
    for (const id of next.ui.focusOrder) next = apply(next, activated(next, windows[id]!.activeTabIds[windows[id]!.spaceId]!));
    set(next);
  },
}))));

export type { CreateWindowOptions } from "../windows/windows";

type StoreActions = { [K in keyof BrowserState as BrowserState[K] extends (...args: never[]) => unknown ? K : never]: BrowserState[K] };

export const storeAction =
  <K extends keyof StoreActions>(name: K): StoreActions[K] =>
  ((...args: unknown[]) => (useBrowser.getState()[name] as (...a: unknown[]) => unknown)(...args)) as StoreActions[K];
