import { cancelDownload, leftDownloadStaging, removeLeftDownloadStaging, type Download } from "../../platform/downloads";
import { endWebKitPrivateSession } from "../../platform/webkit";
import { readDocument, writeDocument } from "../../platform/documents";
import { useBrowser, type BrowserState, type HydrateData } from "../browser/store";
import { inPinnedContainer, isIncognitoProfile, newId, privateSession, snapshotTab } from "../browser/model";
import { earlyLaunchTabOn, launchTab, linkProfile, type LaunchTab } from "../tabs/launchTab";
import { launchBackdrop, type LaunchBackdrop } from "../windows/launchBackdrop";
import { restoreLaunchLook, saveLaunchLook } from "../windows/launchLook";
import { parkWindowPins } from "../pins/parkedPins";
import { isPeekTab } from "../peek/peek";
import type { BrowserWindow, ClosedTab, Tab } from "../browser/types";
import { downloadSession } from "../windows/ui";
import { startFavicons } from "../favicons/favicons";
import { startBookmarks } from "../bookmarks/engineSync";
import { startHistory } from "../history/engineSync";
import { startProfileDataCleanup } from "../profiles/profileData";
import { versionedJson, unchanged, upgraded, type Migrations } from "../../lib/savedDocument";

const SAVE_DELAY_MS = 800;
const SESSION_VERSION = 2;
const SESSION_MIGRATIONS: Migrations = {};
const DOWNLOADS_VERSION = 2;
const DOWNLOADS_MIGRATIONS: Migrations = { 0: unchanged, 1: unchanged };

type Doc = { name: string; sources: (s: BrowserState) => unknown[]; json: (s: BrowserState) => string };

const serialized =
  (version: number, serialize: (s: BrowserState) => object) =>
  (s: BrowserState): string =>
    versionedJson(serialize(s), version);

const persistedTab = ({ navigation: _n, adoptId: _a, wakeAdoptId, pageIn, ...tab }: Tab) => {
  const t = pageIn ? { ...tab, unloaded: true as const } : tab;
  return wakeAdoptId?.startsWith("restore:") && !isIncognitoProfile(t.profileId) ? { ...t, wakeAdoptId } : t;
};
const publicTab = (t: { profileId: string }) => !isIncognitoProfile(t.profileId);

const DOCS: Doc[] = [
  {
    name: "downloads.json",
    sources: (s) => [s.downloads],
    json: serialized(DOWNLOADS_VERSION, (s) => ({
      downloads: s.downloads
        .filter((d) => downloadSession(d) === null)
        .map((d) => (d.state === "downloading" ? { ...d, state: "failed" } : d)),
    })),
  },
  {
    name: "session.json",
    sources: (s) => [s.profiles, s.profileOrder, s.orphanedProfileData, s.windows, s.windowOrder, s.tabs, s.groups, s.splits, s.closedTabs, s.closedWindows, s.parkedPins, s.pinChoices, s.pinSync, s.settings, s.ui.focusedWindowId, s.ui.lastProfileId, s.ui.appDark, s.closedGroups, s.deletedGroups, s.cleanedTabs],
    json: serialized(SESSION_VERSION, (s) => {
      const windows = Object.values(s.windows).filter((w) => !w.incognito && w.kind !== "small").map(({ chromeWindow: _c, ...w }) => w);
      const kept = new Set(windows.map((w) => w.id));
      const focusedWindowId = s.ui.focusOrder.find((id) => kept.has(id)) ?? null;
      return {
        profiles: s.profiles,
        profileOrder: s.profileOrder,
        orphanedProfileData: s.orphanedProfileData,
        settings: s.settings,
        windows,
        windowOrder: s.windowOrder.filter((id) => kept.has(id)),
        focusedWindowId,
        lastProfileId: s.ui.lastProfileId,
        launchTab: earlyLaunchTabOn() ? launchTab(s, focusedWindowId) : null,
        launchBackdrop: earlyLaunchTabOn() ? launchBackdrop(s, focusedWindowId) : null,
        linkProfile: earlyLaunchTabOn() ? linkProfile(s) : null,
        tabs: Object.values(s.tabs).filter((t) => kept.has(t.windowId) && !isPeekTab(s, t.id)).map(persistedTab),
        groups: Object.values(s.groups).filter((g) => kept.has(g.windowId)),
        splits: Object.values(s.splits).filter((v) => kept.has(v.windowId)),
        closedTabs: s.closedTabs.filter((c) => publicTab(c.tab)),
        closedWindows: s.closedWindows.filter((c) => c.tabs.every(publicTab)),
        parkedPins: Object.fromEntries(Object.entries(s.parkedPins).filter(([profileId]) => publicTab({ profileId }))),
        pinChoices: Object.fromEntries(Object.entries(s.pinChoices).filter(([profileId]) => publicTab({ profileId }))),
        pinSync: Object.fromEntries(Object.entries(s.pinSync).filter(([profileId]) => publicTab({ profileId }))),
        closedGroups: s.closedGroups.filter((c) => c.tabs.every(publicTab)),
        deletedGroups: s.deletedGroups.filter((c) => c.tabs.every(publicTab)),
        cleanedTabs: s.cleanedTabs.filter((c) => publicTab(c.tab)),
      };
    }),
  },
];

function read<T>(name: string, version: number, migrations: Migrations): T | null {
  try {
    const json = readDocument(name);
    return json ? (upgraded(JSON.parse(json), version, migrations) as T | null) : null;
  } catch (error) {
    console.warn(`Couldn't read ${name}`, error);
    return null;
  }
}

function write(name: string, json: string) {
  try {
    writeDocument(name, json);
  } catch (error) {
    console.warn(`Couldn't save ${name}`, error);
  }
}

const byId = <T extends { id: string }>(list: T[] | undefined) => Object.fromEntries((list ?? []).map((x) => [x.id, x]));

type SessionV2 = {
  version: 2;
  profiles: HydrateData["profiles"];
  profileOrder: string[];
  orphanedProfileData?: string[];
  settings: HydrateData["settings"];
  windows: BrowserWindow[];
  windowOrder: string[];
  focusedWindowId: string | null;
  lastProfileId?: string | null;
  tabs: Tab[];
  groups: BrowserState["groups"][string][];
  splits: BrowserState["splits"][string][];
  closedTabs: ClosedTab[];
  closedWindows: BrowserState["closedWindows"];
  parkedPins?: BrowserState["parkedPins"];
  pinChoices?: BrowserState["pinChoices"];
  pinSync?: BrowserState["pinSync"];
  closedGroups?: BrowserState["closedGroups"];
  deletedGroups?: BrowserState["deletedGroups"];
  cleanedTabs?: BrowserState["cleanedTabs"];
  launchTab?: LaunchTab | null;
  launchBackdrop?: LaunchBackdrop | null;
  linkProfile?: string | null;
};

let droppedPrivateDownloads = false;

function forgetStaging(id: string) {
  const s = useBrowser.getState();
  const download = s.downloads.find((d) => d.id === id);
  if (!download) return;
  const { staging: _, stagingId: _id, destination: _to, ...kept } = download;
  s.upsertDownload(kept);
}

export function loadSession(): HydrateData | null {
  const session = read<SessionV2>("session.json", SESSION_VERSION, SESSION_MIGRATIONS);
  if (!session) return null;
  const downloads = read<{ downloads: Download[] }>("downloads.json", DOWNLOADS_VERSION, DOWNLOADS_MIGRATIONS);
  droppedPrivateDownloads = (downloads?.downloads ?? []).some((d) => downloadSession(d) !== null);
  const data: HydrateData = {
    profiles: session.profiles,
    profileOrder: session.profileOrder,
    orphanedProfileData: session.orphanedProfileData ?? [],
    settings: session.settings,
    windows: byId(session.windows),
    windowOrder: session.windowOrder,
    focusedWindowId: session.focusedWindowId,
    lastProfileId: session.lastProfileId ?? null,
    tabs: byId(session.tabs),
    groups: byId(session.groups),
    splits: byId(session.splits),
    closedTabs: session.closedTabs,
    closedWindows: session.closedWindows,
    parkedPins: session.parkedPins ?? {},
    pinChoices: session.pinChoices ?? {},
    pinSync: session.pinSync ?? {},
    closedGroups: session.closedGroups ?? [],
    deletedGroups: session.deletedGroups ?? [],
    cleanedTabs: session.cleanedTabs ?? [],
    downloads: (downloads?.downloads ?? []).filter((d) => downloadSession(d) === null).map((d, i) => {
      const id = `saved-${i}`;
      const left = leftDownloadStaging(d);
      const { staging: _, stagingId: _id, destination: _to, ...kept } = d;
      if (!left) return { ...kept, id };
      void removeLeftDownloadStaging(d)
        .catch(() => false)
        .then((removed) => removed && forgetStaging(id));
      return { ...d, id, stagingId: left.uuid };
    }),
  };
  if (session.settings && session.settings.restoreSession === false) {
    const now = Date.now();
    const pinSource = { tabs: data.tabs ?? {}, groups: data.groups ?? {}, splits: data.splits ?? {}, history: {} };
    for (const w of session.windows) data.parkedPins = parkWindowPins(data.parkedPins ?? {}, w, pinSource);
    data.closedWindows = [
      ...(data.closedWindows ?? []),
      ...session.windows.map((w) => ({
        kind: "window" as const,
        id: newId("cw"),
        window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
        tabs: w.tabIds
          .map((id) => data.tabs?.[id])
          .filter((t): t is Tab => !!t && !inPinnedContainer(pinSource, t.id))
          .map((t) => ({ ...snapshotTab(t), active: Object.values(w.activeTabIds).includes(t.id) })),
        groups: [],
        closedAt: now,
      })).filter((c) => c.tabs.some((t) => t.url)),
    ].slice(-10);
    data.windows = {};
    data.windowOrder = [];
    data.tabs = {};
  }
  return data;
}

let flush: () => void = () => {};
let resume: () => void = () => {};
let frozen = false;

export function flushPersistence({ final = false } = {}) {
  flush();
  if (final && !frozen) saveLaunchLook(useBrowser.getState());
  if (final) frozen = true;
}

export function resumePersistence() {
  frozen = false;
  resume();
}

export function startPersistence() {
  useBrowser.getState().hydrate(loadSession() ?? {});
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
      if (lastJson.get(doc.name) !== json) {
        lastJson.set(doc.name, json);
        write(doc.name, json);
      }
    }
    dirty.clear();
  };
  flush = save;

  const check = (s: BrowserState, initial = false) => {
    if (frozen) return;
    for (const doc of DOCS) {
      const sources = doc.sources(s);
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
  resume = () => {
    check(useBrowser.getState());
    save();
  };
  const stopFavicons = startFavicons();
  const stopHistory = startHistory();
  const stopBookmarks = startBookmarks();
  const stopProfileData = startProfileDataCleanup();
  const stopSession = useBrowser.subscribe((s, prev) => {
    check(s);
    if (s.windows !== prev.windows) forgetClosedIncognito(s, prev);
  });
  return () => {
    stopFavicons();
    stopHistory();
    stopBookmarks();
    stopProfileData();
    stopSession();
  };
}

function forgetClosedIncognito(s: BrowserState, prev: BrowserState) {
  for (const w of Object.values(prev.windows)) {
    if (!w.incognito || s.windows[w.id]) continue;
    const session = privateSession(w.profileId);
    if (Object.values(s.windows).some((o) => o.incognito && privateSession(o.profileId) === session)) continue;
    for (const d of s.downloads) if (downloadSession(d) === session && d.state === "downloading") void cancelDownload(d.id);
    s.forgetDownloads(w.profileId);
    if (session !== null) void endWebKitPrivateSession(session);
  }
}
