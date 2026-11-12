import { removeDownloadStaging, type Download } from "../../platform/downloads";
import { documentSaved, readDocument, writeDocument } from "../../platform/documents";
import { SESSION_DOCUMENT } from "./sessionDocument";
import { useBrowser, type BrowserState, type HydrateData } from "../browser/store";
import { inPinnedContainer, isIncognitoProfile, snapshotTab, tabsShownIn } from "../browser/model";
import { earlyLaunchTabOn, launchTab, linkProfile } from "../tabs/launchTab";
import { launchBackdrop } from "../windows/launchBackdrop";
import { restoreLaunchLook, saveLaunchLook } from "../windows/launchLook";
import { parkWindowPins } from "../pins/parkedPins";
import { closedWindowEntry, MAX_CLOSED_WINDOWS } from "../pins/closedTabs";
import { isPeekTab } from "../peek/peek";
import type { BrowserWindow, ClosedWindow, ParkedPins, SplitView, Tab } from "../browser/types";
import { downloadSession } from "../downloads/downloadsSlice";
import { parseSaved, versionedJson, unchanged, type Migrations, type SavedObject } from "../../lib/savedDocument";
import { sessionWithCleanUpMinutes } from "../settings/cleanUpAfter";
import { parseSettingsMeta, sessionWithNewTabLinksInLittleArdia, sessionWithSettingsMeta, sessionWithUnreadCountsOffByDefault } from "../settings/settings";
import { sessionWithOwnTabMutes } from "../tabs/mute";
import { isRegularWindow } from "../windows/small";
import { sessionWithPinChoiceStamps } from "../pins/pinChoices";
import { isFields, isString, isStringList } from "../../lib/decode";
import { pageFromDisk, pinFromDisk, splitsChecked, savedPage, sessionWithSplitSlots, sessionWithTabPages, sessionWithTabPins, slotsFromDisk } from "./savedShapes";

const SAVE_DELAY_MS = 800;
const SESSION_VERSION = 11;
const SESSION_MIGRATIONS: Migrations = { 2: sessionWithCleanUpMinutes, 3: sessionWithOwnTabMutes, 4: sessionWithTabPages, 5: sessionWithTabPins, 6: sessionWithSplitSlots, 7: sessionWithSettingsMeta, 8: sessionWithPinChoiceStamps, 9: sessionWithNewTabLinksInLittleArdia, 10: sessionWithUnreadCountsOffByDefault };
const downloadsWithStagingPathOnly = (doc: SavedObject): SavedObject => ({
  ...doc,
  downloads: Array.isArray(doc.downloads)
    ? doc.downloads.map((d: unknown) => {
        if (typeof d !== "object" || d === null) return d;
        const { stagingId: _id, destination: _to, ...kept } = d as SavedObject;
        return kept;
      })
    : doc.downloads,
});
const DOWNLOADS_VERSION = 3;
const DOWNLOADS_MIGRATIONS: Migrations = { 0: unchanged, 1: unchanged, 2: downloadsWithStagingPathOnly };

type Key = keyof BrowserState;
type Field<K extends Key, V> = { reads: readonly K[]; save: (s: Pick<BrowserState, K>) => V };
const field = <K extends Key, V>(reads: readonly K[], save: (s: Pick<BrowserState, K>) => V): Field<K, V> => ({ reads, save });

type Doc = { name: string; reads: readonly Key[]; json: (s: BrowserState) => string };

function doc<F extends Record<string, Field<Key, unknown>>>(name: string, version: number, fields: F): Doc {
  const entries = Object.entries(fields);
  return {
    name,
    reads: [...new Set(entries.flatMap(([, f]) => f.reads))],
    json: (s) => versionedJson(Object.fromEntries(entries.map(([key, f]) => [key, f.save(s)])), version),
  };
}

const publicTab = (t: { profileId: string }) => !isIncognitoProfile(t.profileId);
const publicProfiles = <T,>(byProfile: Record<string, T>) => Object.fromEntries(Object.entries(byProfile).filter(([profileId]) => publicTab({ profileId })));

const persistedTab = (t: Tab) => ({ ...t, page: savedPage(t) });
const savedWindows = (s: Pick<BrowserState, "windows">) =>
  Object.values(s.windows).filter(isRegularWindow).map(({ chromeWindow: _c, kind: _k, ...w }) => ({ ...w, incognito: false }));
const savedWindowsWithTabsShown = (s: Pick<BrowserState, "windows" | "settings">) => savedWindows(s).map((w) => ({ ...w, sidebarOpen: tabsShownIn(s, w.id) }));
const savedWindowIds = (s: Pick<BrowserState, "windows">) => new Set(savedWindows(s).map((w) => w.id));
const savedFocus = (s: Pick<BrowserState, "windows" | "ui">) => {
  const kept = savedWindowIds(s);
  return s.ui.focusOrder.find((id) => kept.has(id)) ?? null;
};

const SESSION_FIELDS = {
  profiles: field(["profiles"], (s) => s.profiles),
  profileOrder: field(["profileOrder"], (s) => s.profileOrder),
  orphanedProfileData: field(["orphanedProfileData"], (s) => s.orphanedProfileData),
  settings: field(["settings"], (s) => s.settings),
  settingsMeta: field(["settingsMeta"], (s) => s.settingsMeta),
  windows: field(["windows", "settings"], savedWindowsWithTabsShown),
  windowOrder: field(["windows", "windowOrder"], (s) => {
    const kept = savedWindowIds(s);
    return s.windowOrder.filter((id) => kept.has(id));
  }),
  focusedWindowId: field(["windows", "ui"], savedFocus),
  lastProfileId: field(["ui"], (s) => s.ui.lastProfileId),
  launchTab: field(["windows", "tabs", "settings", "profiles", "ui"], (s) => (earlyLaunchTabOn() ? launchTab(s, savedFocus(s)) : null)),
  launchBackdrop: field(["windows", "profiles", "ui", "settings"], (s) => (earlyLaunchTabOn() ? launchBackdrop(s, savedFocus(s)) : null)),
  linkProfile: field(["windows", "profiles", "ui", "windowOrder", "settings"], (s) => (earlyLaunchTabOn() ? linkProfile(s) : null)),
  tabs: field(["windows", "tabs", "peeks"], (s) => {
    const kept = savedWindowIds(s);
    return Object.values(s.tabs).filter((t) => kept.has(t.windowId) && !isPeekTab(s, t.id)).map(persistedTab);
  }),
  groups: field(["windows", "groups"], (s) => {
    const kept = savedWindowIds(s);
    return Object.values(s.groups).filter((g) => kept.has(g.windowId));
  }),
  splits: field(["windows", "splits"], (s) => {
    const kept = savedWindowIds(s);
    return Object.values(s.splits).filter((v) => kept.has(v.windowId));
  }),
  closedTabs: field(["closedTabs"], (s) => s.closedTabs.filter((c) => publicTab(c.tab))),
  closedWindows: field(["closedWindows", "settings"], (s) =>
    s.closedWindows.filter((c) => c.tabs.every(publicTab)).map((c) => ({ ...c, window: { ...c.window, sidebarOpen: !s.settings.autoHideTabs } })),
  ),
  parkedPins: field(["parkedPins"], (s) => publicProfiles(s.parkedPins)),
  pinChoices: field(["pinChoices"], (s) => publicProfiles(s.pinChoices)),
  pinSync: field(["pinSync"], (s) => publicProfiles(s.pinSync)),
  topAppsMerged: field(["topAppsMerged"], (s) => s.topAppsMerged),
  closedGroups: field(["closedGroups"], (s) => s.closedGroups.filter((c) => c.tabs.every(publicTab))),
  deletedGroups: field(["deletedGroups"], (s) => s.deletedGroups.filter((c) => c.tabs.every(publicTab))),
  cleanedTabs: field(["cleanedTabs"], (s) => s.cleanedTabs.filter((c) => publicTab(c.tab))),
};

const DOWNLOADS_FIELDS = {
  downloads: field(["downloads", "profiles"], (s) =>
    s.downloads.filter((d) => downloadSession(s, d) === null).map((d) => (d.state === "downloading" ? { ...d, state: "failed" } : d)),
  ),
};

const DOCS: Doc[] = [doc("downloads.json", DOWNLOADS_VERSION, DOWNLOADS_FIELDS), doc(SESSION_DOCUMENT, SESSION_VERSION, SESSION_FIELDS)];

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);
const has = (o: SavedObject, keys: readonly string[]) => keys.every((k) => isString(o[k]));
const rows = <T,>(v: unknown, ok: (o: SavedObject) => boolean): T[] => (Array.isArray(v) ? v.filter((o): o is SavedObject => isFields(o) && ok(o)) : []) as T[];
const byProfile = <T,>(v: unknown, ok: (o: SavedObject) => boolean = () => true): Record<string, T> =>
  (isFields(v) ? Object.fromEntries(Object.entries(v).filter(([, o]) => isFields(o) && ok(o))) : {}) as Record<string, T>;
const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x]));
const nullableString = (v: unknown) => (isString(v) ? v : null);

const windowOk = (o: SavedObject) => has(o, ["id", "profileId"]) && isStringList(o.tabIds) && isFields(o.activeTabIds) && Object.values(o.activeTabIds).every(isString);
const tabOk = (o: SavedObject) => has(o, ["id", "windowId", "profileId", "url"]);
const groupOk = (o: SavedObject) => has(o, ["id", "windowId", "profileId"]) && isStringList(o.tabIds);
const splitOk = (o: SavedObject) => has(o, ["id", "windowId"]) && (o.orientation === "horizontal" || o.orientation === "vertical") && !!slotsFromDisk(o.slots);
const snapshotOk = (o: unknown) => isFields(o) && has(o, ["url", "profileId"]);
const closedTabOk = (o: SavedObject) => isString(o.id) && snapshotOk(o.tab);
const tabListOk = (o: SavedObject) => isString(o.id) && Array.isArray(o.tabs) && o.tabs.every(snapshotOk);
const profileOk = (o: SavedObject) => has(o, ["id", "name"]);
const parkedOk = (o: SavedObject) => Array.isArray(o.tabs) && o.tabs.every(snapshotOk) && Array.isArray(o.groups);

type SavedSession = Omit<HydrateData, "history" | "bookmarks" | "downloads"> & {
  windows: Record<string, BrowserWindow>;
  tabs: Record<string, Tab>;
  windowsAgainstAutoHideTabs: number;
};

function settingsWithAutoHideTabs(settings: unknown, windows: SavedObject[]): HydrateData["settings"] {
  if (!isFields(settings)) return undefined;
  if ("autoHideTabs" in settings || !windows.length) return settings as HydrateData["settings"];
  return { ...settings, autoHideTabs: windows.every((w) => w.sidebarOpen === false) } as HydrateData["settings"];
}

function withoutSavedTabsShown(closed: ClosedWindow): ClosedWindow {
  if (!isFields(closed.window)) return closed;
  const { sidebarOpen: _, ...window } = closed.window as ClosedWindow["window"] & { sidebarOpen?: unknown };
  return { ...closed, window };
}

function windowsAgainstAutoHideTabs(settings: HydrateData["settings"], windows: SavedObject[]): number {
  const hidden = !!settings?.autoHideTabs;
  return windows.filter((w) => typeof w.sidebarOpen === "boolean" && w.sidebarOpen === hidden).length;
}

export function parseSession(json: string | null | undefined): SavedSession | null {
  const raw = parseSaved(json, SESSION_VERSION, SESSION_MIGRATIONS);
  if (!raw) return null;
  const savedWindowRows = rows<SavedObject>(raw.windows, windowOk);
  const settings = settingsWithAutoHideTabs(raw.settings, savedWindowRows);
  return {
    windowsAgainstAutoHideTabs: windowsAgainstAutoHideTabs(settings, savedWindowRows),
    profiles: byProfile(raw.profiles, profileOk),
    profileOrder: strings(raw.profileOrder),
    orphanedProfileData: strings(raw.orphanedProfileData),
    settings,
    settingsMeta: parseSettingsMeta(raw.settingsMeta),
    windows: byId(rows<BrowserWindow & { incognito?: unknown; sidebarOpen?: unknown }>(raw.windows, windowOk).map(({ incognito: _i, sidebarOpen: _s, ...w }): BrowserWindow => ({ ...w, kind: "main" }))),
    windowOrder: strings(raw.windowOrder),
    focusedWindowId: nullableString(raw.focusedWindowId),
    lastProfileId: nullableString(raw.lastProfileId),
    tabs: byId(rows<Tab>(raw.tabs, tabOk).map((t) => ({ ...t, page: pageFromDisk(t.page), pin: pinFromDisk(t.pin) }))),
    groups: byId(rows(raw.groups, groupOk)),
    splits: byId(rows<SplitView>(raw.splits, splitOk).map((v) => ({ ...v, slots: slotsFromDisk(v.slots)! }))),
    closedTabs: rows(raw.closedTabs, closedTabOk),
    closedWindows: rows<ClosedWindow>(raw.closedWindows, tabListOk).map(splitsChecked).map(withoutSavedTabsShown),
    parkedPins: Object.fromEntries(Object.entries(byProfile<ParkedPins>(raw.parkedPins, parkedOk)).map(([p, park]) => [p, splitsChecked(park)])),
    pinChoices: byProfile(raw.pinChoices),
    pinSync: byProfile(raw.pinSync),
    topAppsMerged: typeof raw.topAppsMerged === "string" ? raw.topAppsMerged : undefined,
    closedGroups: rows(raw.closedGroups, tabListOk),
    deletedGroups: rows(raw.deletedGroups, tabListOk),
    cleanedTabs: rows(raw.cleanedTabs, closedTabOk),
  };
}

function read(name: string): string | null {
  try {
    return readDocument(name);
  } catch (error) {
    console.warn(`Couldn't read ${name}`, error);
    return null;
  }
}

function write(name: string, json: string): boolean {
  try {
    writeDocument(name, json);
    return true;
  } catch (error) {
    console.warn(`Couldn't save ${name}`, error);
    return false;
  }
}

let droppedPrivateDownloads = false;

function forgetStaging(id: string) {
  const s = useBrowser.getState();
  const download = s.downloads.find((d) => d.id === id);
  if (!download) return;
  const { staging: _, ...kept } = download;
  s.upsertDownload(kept);
}

function savedDownloads(saved: Pick<BrowserState, "profiles">): Download[] {
  const raw = parseSaved(read("downloads.json"), DOWNLOADS_VERSION, DOWNLOADS_MIGRATIONS);
  const downloads = rows<Download>(raw?.downloads, (d) => isString(d.id) && isString(d.state));
  droppedPrivateDownloads = downloads.some((d) => downloadSession(saved, d) !== null);
  return downloads.filter((d) => downloadSession(saved, d) === null).map((d, i) => {
    const id = `saved-${i}`;
    const { staging, ...kept } = d;
    if (!staging || d.state === "downloading") return { ...kept, id };
    void removeDownloadStaging(staging)
      .catch(() => false)
      .then((removed) => removed && forgetStaging(id));
    return { ...d, id };
  });
}

function closedForLaunch(session: SavedSession): HydrateData {
  const now = Date.now();
  const pinSource = { tabs: session.tabs, groups: session.groups ?? {}, splits: session.splits ?? {}, history: {}, profiles: session.profiles ?? {} };
  let parkedPins = session.parkedPins ?? {};
  for (const w of Object.values(session.windows)) parkedPins = parkWindowPins(parkedPins, w, pinSource);
  const closedWindows = [
    ...(session.closedWindows ?? []).filter((c) => c.tabs.length).map(({ lastWindow: _, activePin: __, ...c }) => c),
    ...Object.values(session.windows)
      .map((w) =>
        closedWindowEntry(
          w,
          w.tabIds
            .map((id) => session.tabs[id])
            .filter((t): t is Tab => !!t && !inPinnedContainer(pinSource, t.id))
            .map((t) => ({ ...snapshotTab(t), active: Object.values(w.activeTabIds).includes(t.id) })),
          [],
          now,
        ),
      )
      .filter((c) => c.tabs.some((t) => t.url)),
  ].slice(-MAX_CLOSED_WINDOWS);
  return { ...session, parkedPins, closedWindows, windows: {}, windowOrder: [], tabs: {} };
}

export type LaunchOverrides = { restoreSession?: boolean };

export function loadSession({ restoreSession }: LaunchOverrides = {}): (HydrateData & { windowsAgainstAutoHideTabs: number }) | null {
  const session = parseSession(read(SESSION_DOCUMENT));
  if (!session) return null;
  const downloads = savedDownloads({ profiles: session.profiles ?? {} });
  const restore = restoreSession ?? session.settings?.restoreSession !== false;
  const data = restore ? session : closedForLaunch(session);
  return { ...data, downloads, windowsAgainstAutoHideTabs: restore ? session.windowsAgainstAutoHideTabs : 0 };
}

let flush: () => void = () => {};
let unstaged: () => boolean = () => false;
let resume: () => void = () => {};
let frozen = false;

export function flushPersistence({ final = false } = {}): boolean {
  const saving = !frozen;
  flush();
  if (final && !frozen) saveLaunchLook(useBrowser.getState());
  if (final) frozen = true;
  return saving;
}

export async function sessionSaved(): Promise<boolean> {
  if (!flushPersistence() || unstaged()) return false;
  try {
    await documentSaved(SESSION_DOCUMENT);
    return !frozen;
  } catch {
    return false;
  }
}

export function resumePersistence() {
  frozen = false;
  resume();
}

let restoredAtLaunch = false;
let realignedAtLaunch = 0;

export const sessionRestoredAtLaunch = () => restoredAtLaunch;
export const windowsRealignedToAutoHideTabsAtLaunch = () => realignedAtLaunch;

export function startPersistence(overrides: LaunchOverrides = {}) {
  const loaded = loadSession(overrides);
  restoredAtLaunch = !!loaded?.windowOrder?.length;
  realignedAtLaunch = loaded?.windowsAgainstAutoHideTabs ?? 0;
  useBrowser.getState().hydrate(loaded ?? {});
  restoreLaunchLook();

  const lastSources = new Map<string, unknown[]>();
  const lastJson = new Map<string, string>();
  const dirty = new Set<Doc>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    if (frozen) return;
    const s = useBrowser.getState();
    for (const doc of DOCS.filter((d) => dirty.has(d))) {
      const json = doc.json(s);
      if (lastJson.get(doc.name) === json || write(doc.name, json)) {
        lastJson.set(doc.name, json);
        dirty.delete(doc);
      }
    }
    if (dirty.size) timer = setTimeout(save, SAVE_DELAY_MS);
  };
  flush = save;
  unstaged = () => [...dirty].some((d) => d.name === SESSION_DOCUMENT);

  const check = (s: BrowserState, initial = false) => {
    if (frozen) return;
    for (const doc of DOCS) {
      const sources = doc.reads.map((key) => s[key]);
      const prev = lastSources.get(doc.name);
      if (prev && sources.every((v, i) => v === prev[i])) continue;
      lastSources.set(doc.name, sources);
      if (!initial) dirty.add(doc);
    }
    if (dirty.size && !timer) timer = setTimeout(save, SAVE_DELAY_MS);
  };
  check(useBrowser.getState(), true);
  if (droppedPrivateDownloads) {
    droppedPrivateDownloads = false;
    dirty.add(DOCS.find((d) => d.name === "downloads.json")!);
    timer ??= setTimeout(save, SAVE_DELAY_MS);
  }
  if (realignedAtLaunch) {
    dirty.add(DOCS.find((d) => d.name === SESSION_DOCUMENT)!);
    timer ??= setTimeout(save, SAVE_DELAY_MS);
  }
  resume = () => {
    check(useBrowser.getState());
    save();
  };
  return useBrowser.subscribe((s) => check(s));
}
