import { appUrlOrigin, displayHost } from "@ardia/core";
import type { BrowserState } from "./browser";
import { DEFAULT_PROFILE_ID } from "./settings";
import type { BrowserWindow, Profile, Tab, TabGroup, TabLive, TabSnapshot } from "./types";


const launch = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let counter = 0;
export const newId = (prefix: string) => `${prefix}-${launch}-${(++counter).toString(36)}`;
export const restoreId = (tabId: string) => `restore:${tabId}`;
export const pendingRestore = (t: Pick<Tab, "wakeAdoptId">): string | undefined =>
  t.wakeAdoptId?.startsWith("restore:") ? t.wakeAdoptId.slice("restore:".length) : undefined;

let navSeq = 0;
export const navigationTo = (url: string, userInitiated = false) => ({ url, seq: ++navSeq, ...(userInitiated ? { userInitiated } : {}) });

export const incognitoProfileId = (windowId: string, originalProfileId: string) => `incognito:${windowId}@${originalProfileId}`;
export const isIncognitoProfile = (profileId: string) => profileId.startsWith("incognito:");
export const incognitoOriginal = (profileId: string) => {
  const at = profileId.indexOf("@");
  return at < 0 ? DEFAULT_PROFILE_ID : profileId.slice(at + 1);
};

let sharedDataIds: Record<string, string> = {};
export const setSharedDataIds = (map: Record<string, string>) => {
  sharedDataIds = map;
};

export const engineProfile = (profileId: string): string => {
  if (isIncognitoProfile(profileId)) {
    const at = profileId.indexOf("@");
    return `${at < 0 ? profileId : profileId.slice(0, at)}@${engineProfile(incognitoOriginal(profileId))}`;
  }
  const id = sharedDataIds[profileId] ?? profileId;
  return id === DEFAULT_PROFILE_ID ? "" : id;
};

export const privateSession = (profileId: string): string | null =>
  isIncognitoProfile(profileId) ? engineProfile(incognitoOriginal(profileId)) : null;

const INCOGNITO_PROFILE: Profile = { id: "incognito", name: "Incognito", color: "neutral", icon: null, createdAt: 0 };

export const IDLE_LIVE: TabLive = {
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  playingAudio: false,
  themeColor: null,
};

export function makeTab(windowId: string, profileId: string, url = "", snapshot?: Partial<TabSnapshot>): Tab {
  const now = Date.now();
  return {
    id: newId("tab"),
    windowId,
    profileId,
    url,
    title: "",
    favicon: null,
    pinned: false,
    muted: false,
    zoom: 1,
    customTitle: null,
    customIcon: null,
    pinnedUrl: null,
    openerId: null,
    ...snapshot,
    navigation: url ? navigationTo(url) : null,
    createdAt: now,
    lastActiveAt: now,
  };
}

export function wake(t: Tab): Partial<Tab> {
  return t.wakeAdoptId ? { adoptId: t.wakeAdoptId, wakeAdoptId: undefined, unloaded: undefined } : { navigation: navigationTo(t.url), unloaded: undefined };
}

export const snapshotTab = (t: Tab): TabSnapshot => ({
  url: t.url,
  title: t.title,
  favicon: t.favicon,
  pinned: t.pinned,
  muted: t.muted,
  zoom: t.zoom,
  customTitle: t.customTitle,
  customIcon: t.customIcon,
  pinnedUrl: t.pinnedUrl,
  ...(isPinnedRow(t) ? { pinnedAsRow: true as const } : {}),
  ...(t.tileFolder && pinSection(t) === "tile" ? { tileFolder: t.tileFolder } : {}),
  profileId: t.profileId,
});

export const isPinnedRow = (t: Pick<Tab, "pinned" | "pinnedAsRow"> | undefined): boolean => !!t?.pinned && !!t.pinnedAsRow;
export const pinnedSectionTitle = (s: BrowserState, tab: Pick<Tab, "profileId"> | undefined) => `Pinned in ${s.profiles[tab?.profileId ?? ""]?.name ?? "Profile"}`;
export const togglePinTitle = (tab: Pick<Tab, "pinned" | "pinnedAsRow"> | undefined) => (isPinnedRow(tab) ? "Unpin" : tab?.pinned ? "Unpin from Top Apps" : "Move to Top Apps");

export type PinSection = "tile" | "row" | "none";
export const pinSection = (t: Pick<Tab, "pinned" | "pinnedAsRow"> | undefined): PinSection => (!t?.pinned ? "none" : t.pinnedAsRow ? "row" : "tile");

export function pinnedFirst(ids: string[], tabs: Record<string, Tab>, groups?: Record<string, TabGroup>): string[] {
  const pinnedGroup = new Set(groups ? Object.values(groups).filter((g) => g.pinned).flatMap((g) => g.tabIds) : []);
  const pinnedArea = (id: string) => pinSection(tabs[id]) === "row" || (!tabs[id]?.pinned && pinnedGroup.has(id));
  return [
    ...ids.filter((id) => pinSection(tabs[id]) === "tile"),
    ...ids.filter(pinnedArea),
    ...ids.filter((id) => !tabs[id]?.pinned && !pinnedArea(id)),
  ];
}

export function inPinnedContainer(s: Pick<BrowserState, "tabs" | "groups">, id: string): boolean {
  const tab = s.tabs[id];
  if (!tab) return false;
  if (tab.pinned) return true;
  for (const g of Object.values(s.groups)) if (g.pinned && g.tabIds.includes(id)) return true;
  return false;
}

export function viewTabIds(s: BrowserState, windowId: string, profileId?: string): string[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const profile = profileId ?? w.profileId;
  return w.tabIds.filter((id) => s.tabs[id]?.profileId === profile);
}

export function closesWindow(s: BrowserState, id: string): boolean {
  const tab = s.tabs[id];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w || tab.profileId !== w.profileId || inPinnedContainer(s, id)) return false;
  return viewTabIds(s, w.id).every((t) => t === id || s.tabs[t]!.unloaded);
}

export function activeTabId(s: BrowserState, windowId: string, profileId?: string): string | undefined {
  const w = s.windows[windowId];
  if (!w) return undefined;
  const id = w.activeTabIds[profileId ?? w.profileId];
  return id && s.tabs[id]?.windowId === windowId ? id : undefined;
}

export function activeTab(s: BrowserState, windowId: string): Tab | undefined {
  const id = activeTabId(s, windowId);
  return id ? s.tabs[id] : undefined;
}

export function profileFor(s: BrowserState, profileId: string): Profile {
  return isIncognitoProfile(profileId) ? INCOGNITO_PROFILE : (s.profiles[profileId] ?? s.profiles[s.settings.defaultProfileId] ?? INCOGNITO_PROFILE);
}

export function bookmarkProfileId(s: BrowserState, window: BrowserWindow | undefined): string {
  const id = window?.incognito ? window.originalProfileId : window?.profileId;
  return id && s.profiles[id] ? id : s.settings.defaultProfileId;
}

export function resolveWindowId(s: BrowserState, id?: string | null): string | undefined {
  if (id && s.windows[id]) return id;
  const main = (w: string) => !!s.windows[w] && s.windows[w]!.kind !== "small";
  return s.ui.focusOrder.find(main) ?? s.windowOrder.find(main);
}

export function tabLayoutOf(s: BrowserState, windowId?: string | null): "sidebar" | "top" {
  const id = resolveWindowId(s, windowId);
  return (id && s.windows[id]!.tabLayout) || s.settings.tabLayout;
}

export function merge<T extends object>(obj: T, patch: Partial<T>): T {
  for (const key in patch) {
    if (!Object.is(obj[key], patch[key])) return { ...obj, ...patch };
  }
  return obj;
}

export function without<T>(map: Record<string, T>, ids: Iterable<string>): Record<string, T> {
  const next = { ...map };
  for (const id of ids) delete next[id];
  return next;
}

export function tabLabel(t: Pick<Tab, "url" | "title" | "customTitle">): string {
  if (t.customTitle) return t.customTitle;
  if (!t.url) return "New Tab";
  const app = appUrlOrigin(t.url);
  if (app) return app;
  try {
    const u = new URL(t.url);
    if (u.protocol === "file:") return t.title || decodeURIComponent(u.pathname.split("/").pop() ?? "");
    return displayHost(u.hostname).replace(/^www\./, "") || t.title || t.url;
  } catch {
    return t.title || t.url;
  }
}

export function findLast<T>(list: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i]!)) return list[i];
  return undefined;
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function windowTitle(s: BrowserState, windowId: string): string {
  const w = s.windows[windowId];
  if (!w) return "";
  const tab = activeTab(s, windowId);
  const others = viewTabIds(s, windowId).length - 1;
  const label = tab ? tabLabel(tab) : "New Tab";
  return `${profileFor(s, w.profileId).name} — ${label}${others > 0 ? ` & ${plural(others, "Tab")}` : ""}`;
}
