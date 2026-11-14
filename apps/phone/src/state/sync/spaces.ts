import { landingKey } from "../../lib/url.ts";
import type { BookmarkItem, PinnedSection, PinnedTile, SyncedDevice, SyncedHistoryItem, SyncedProfile } from "../../platform/sync.ts";

export const COLLAPSED_LIMIT = 8;
export const IDLE_MAC_TABS = 3;

export type SpaceRow =
  | { kind: "tiles"; key: string; tiles: PinnedTile[] }
  | { kind: "tab"; key: string; title: string; url: string; depth: number; icon: string | null }
  | { kind: "group"; key: string; title: string; depth: number; isOpen: boolean; icon: string | null; color: string | null }
  | { kind: "folder"; key: string; title: string; depth: number; isOpen: boolean }
  | { kind: "header"; key: string; title: string; icon: "star" | "laptop" | "desktop" | "phone" }
  | { kind: "showAll"; key: string; deviceId: string }
  | { kind: "empty"; key: string; name: string };

const hostOf = (url: string) => /^[a-z]+:\/\/(?:www\.)?([^/?#:]+)/i.exec(url)?.[1] ?? url;

export const remoteTitle = (title: string, url: string) => title.trim() || hostOf(url);

function pinnedRows(sections: readonly PinnedSection[], depth: number, open: ReadonlySet<string>, rows: SpaceRow[]) {
  for (const section of sections) {
    if (section.tab) {
      rows.push({ kind: "tab", key: `pinned:${section.tab.key}:${depth}`, title: remoteTitle(section.tab.title, section.tab.url), url: section.tab.url, depth, icon: section.tab.icon });
    } else if (section.group) {
      const key = `group:${section.group.key}`;
      const isOpen = open.has(key);
      rows.push({ kind: "group", key, title: section.group.name, depth, isOpen, icon: section.group.icon, color: section.group.color });
      if (isOpen) pinnedRows(section.group.items, depth + 1, open, rows);
    }
  }
}

function bookmarkRows(items: readonly BookmarkItem[], depth: number, open: ReadonlySet<string>, rows: SpaceRow[]) {
  for (const item of items) {
    if (item.url) {
      rows.push({ kind: "tab", key: `bookmark:${item.key}`, title: remoteTitle(item.title, item.url), url: item.url, depth, icon: null });
      continue;
    }
    const key = `folder:${item.key}`;
    const isOpen = open.has(key);
    rows.push({ kind: "folder", key, title: item.title, depth, isOpen });
    if (isOpen) bookmarkRows(item.children ?? [], depth + 1, open, rows);
  }
}

export function spaceRows(profile: SyncedProfile, openGroups: ReadonlySet<string>, expandedDevices: ReadonlySet<string>): SpaceRow[] {
  const rows: SpaceRow[] = [];
  if (profile.pinned.tiles.length) rows.push({ kind: "tiles", key: "tiles", tiles: profile.pinned.tiles });
  pinnedRows(profile.pinned.sections, 0, openGroups, rows);
  if (profile.bookmarks.length) {
    rows.push({ kind: "header", key: "bookmarks-header", title: "Bookmarks", icon: "star" });
    bookmarkRows(profile.bookmarks, 0, openGroups, rows);
  }
  const devices = profile.deviceTabs.filter((device) => device.tabs.length > 0);
  for (const device of devices) {
    const expanded = expandedDevices.has(device.deviceId) || device.tabs.length <= COLLAPSED_LIMIT + 1;
    const icon = device.kind === "phone" ? "phone" : device.deviceName.toLowerCase().includes("macbook") ? "laptop" : "desktop";
    rows.push({ kind: "header", key: `device:${device.deviceId}`, title: device.deviceName, icon });
    const shown = expanded ? device.tabs : device.tabs.slice(0, COLLAPSED_LIMIT);
    shown.forEach((tab, index) =>
      rows.push({ kind: "tab", key: `remote:${device.deviceId}:${index}`, title: remoteTitle(tab.title, tab.url), url: tab.url, depth: 0, icon: null }),
    );
    if (!expanded) rows.push({ kind: "showAll", key: `more:${device.deviceId}`, deviceId: device.deviceId });
  }
  const pinnedEmpty = profile.pinned.tiles.length === 0 && profile.pinned.sections.length === 0;
  if (pinnedEmpty && devices.length === 0 && profile.bookmarks.length === 0) rows.push({ kind: "empty", key: "empty", name: profile.name });
  return rows;
}

function bookmarkUrls(items: readonly BookmarkItem[], out: string[] = []): string[] {
  for (const item of items) {
    if (item.url) out.push(item.url);
    if (item.children) bookmarkUrls(item.children, out);
  }
  return out;
}

export const pinKey = (profileSyncId: string | null, url: string) => `${profileSyncId ?? ""}|${landingKey(url)}`;

export function isPinnedOnMac(profile: SyncedProfile | null, url: string, onTheirWay: readonly string[] = []): boolean {
  if (!profile) return false;
  if (onTheirWay.includes(pinKey(profile.syncId, url))) return true;
  const key = landingKey(url);
  return bookmarkUrls(profile.bookmarks).some((bookmark) => landingKey(bookmark) === key);
}

export function pinsStillOnTheirWay(onTheirWay: readonly string[], profiles: readonly SyncedProfile[]): string[] {
  const arrived = new Set(profiles.flatMap((profile) => bookmarkUrls(profile.bookmarks).map((url) => pinKey(profile.syncId, url))));
  return onTheirWay.filter((key) => !arrived.has(key));
}

export type HistoryRowLike = { url: string; title: string; favicon: string | null; visits: number; lastVisit: number };

export function mergeSyncedHistory(local: readonly HistoryRowLike[], synced: readonly SyncedHistoryItem[]): HistoryRowLike[] {
  const merged = new Map<string, HistoryRowLike>();
  for (const row of local) merged.set(row.url, { ...row });
  for (const item of synced) {
    const known = merged.get(item.url);
    if (known) merged.set(item.url, { ...known, title: known.title || item.title, visits: known.visits + item.visits, lastVisit: Math.max(known.lastVisit, item.lastVisit) });
    else merged.set(item.url, { url: item.url, title: item.title, favicon: null, visits: item.visits, lastVisit: item.lastVisit });
  }
  return [...merged.values()];
}

export function syncedBookmarks(profile: SyncedProfile): { url: string; title: string; favicon: string | null }[] {
  const out: { url: string; title: string; favicon: string | null }[] = [];
  const walk = (items: readonly BookmarkItem[]) => {
    for (const item of items) {
      if (item.url) out.push({ url: item.url, title: item.title, favicon: null });
      if (item.children) walk(item.children);
    }
  };
  walk(profile.bookmarks);
  for (const tile of profile.pinned.tiles) {
    out.push({ url: tile.url, title: tile.title, favicon: tile.icon });
    for (const tab of tile.folder ?? []) out.push({ url: tab.url, title: tab.title, favicon: tab.icon });
  }
  return out;
}

export function macTabIndex(profile: SyncedProfile | null, devices: readonly SyncedDevice[]): Map<string, string> {
  const index = new Map<string, string>();
  if (!profile) return index;
  const current = new Set(devices.filter((d) => d.isCurrent).map((d) => d.id));
  for (const device of profile.deviceTabs) {
    if (device.kind !== "mac" || current.has(device.deviceId)) continue;
    for (const tab of device.tabs) if (!index.has(landingKey(tab.url))) index.set(landingKey(tab.url), device.deviceName);
  }
  return index;
}

export function idleMacTabs(profile: SyncedProfile | null, devices: readonly SyncedDevice[]): { url: string; title: string; deviceName: string }[] {
  if (!profile) return [];
  const current = new Set(devices.filter((d) => d.isCurrent).map((d) => d.id));
  const device = profile.deviceTabs.find((d) => d.kind === "mac" && !current.has(d.deviceId) && d.tabs.length > 0);
  if (!device) return [];
  return device.tabs
    .filter((tab) => /^https?:\/\//i.test(tab.url))
    .slice(0, IDLE_MAC_TABS)
    .map((tab) => ({ url: tab.url, title: remoteTitle(tab.title, tab.url), deviceName: device.deviceName }));
}
