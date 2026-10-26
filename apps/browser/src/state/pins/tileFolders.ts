import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { newId, pinSection } from "../browser/model";
import { placing } from "./organize";
import type { ParkedPins, Tab, TileFolder } from "../browser/types";

export const FOLDER_CELL = "folder:";
export const folderCell = (folderId: string) => `${FOLDER_CELL}${folderId}`;
export const folderIdOfCell = (key: string): string | null => (key.startsWith(FOLDER_CELL) ? key.slice(FOLDER_CELL.length) : null);

export const tileFolderOf = (t: Tab | undefined): TileFolder | undefined => (t?.tileFolder && pinSection(t) === "tile" ? t.tileFolder : undefined);

export const folderLabel = (folder: TileFolder | undefined) => folder?.name.trim() || "Folder";

export function withTileFolder(t: Tab, folder: TileFolder | undefined): Tab {
  if (t.tileFolder === folder) return t;
  const { tileFolder: _, ...rest } = t;
  return folder ? { ...rest, tileFolder: folder } : rest;
}

export function tileCells(tabs: Record<string, Tab>, tiles: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of tiles) {
    const folder = tileFolderOf(tabs[id]);
    if (!folder) out.push(id);
    else if (!seen.has(folder.id)) {
      seen.add(folder.id);
      out.push(folderCell(folder.id));
    }
  }
  return out;
}

export function folderMembers(s: Pick<BrowserState, "tabs" | "windows">, windowId: string, folderId: string): string[] {
  let profileId: string | undefined;
  return (s.windows[windowId]?.tabIds ?? []).filter((id) => {
    const t = s.tabs[id];
    if (tileFolderOf(t)?.id !== folderId) return false;
    profileId ??= t!.profileId;
    return t!.profileId === profileId;
  });
}



export function folderIn(s: Pick<BrowserState, "tabs" | "windows">, windowId: string, folderId: string): TileFolder | undefined {
  const first = folderMembers(s, windowId, folderId)[0];
  return first ? tileFolderOf(s.tabs[first]) : undefined;
}

const after = (s: BrowserState, windowId: string, anchor: string | undefined, skip: string[]) => {
  const ids = s.windows[windowId]?.tabIds ?? [];
  const at = anchor ? ids.indexOf(anchor) : -1;
  return at < 0 ? null : (ids.slice(at + 1).find((id) => !skip.includes(id)) ?? null);
};

function sameWindow(s: BrowserState, ids: string[], anchor: Tab): string[] {
  const order = s.windows[anchor.windowId]?.tabIds ?? [];
  return [...new Set(ids)].filter((id) => s.tabs[id]?.windowId === anchor.windowId && s.tabs[id]!.profileId === anchor.profileId).sort((a, z) => order.indexOf(a) - order.indexOf(z));
}

export function addToTileFolder(s: BrowserState, ids: string[], ontoId: string, beforeId?: string | null): BrowserState {
  const onto = s.tabs[ontoId];
  if (pinSection(onto) !== "tile") return s;
  const folder = tileFolderOf(onto) ?? { id: newId("tf"), name: "" };
  const moving = sameWindow(s, ids, onto!).filter((id) => id !== ontoId);
  const next = onto!.tileFolder === folder ? s : { ...s, tabs: { ...s.tabs, [ontoId]: withTileFolder(onto!, folder) } };
  if (!moving.length) return next;
  const last = folderMembers(next, onto!.windowId, folder.id).filter((id) => !moving.includes(id)).at(-1);
  const at = beforeId && !moving.includes(beforeId) ? beforeId : after(next, onto!.windowId, last, moving);
  return placing(next, moving, { pinned: true, row: false, beforeId: at, tileFolder: folder });
}

export function newTileFolder(s: BrowserState, ids: string[], name = ""): { state: BrowserState; folderId: string | null } {
  const first = s.tabs[ids[0] ?? ""];
  if (!first || !s.windows[first.windowId]) return { state: s, folderId: null };
  const moving = sameWindow(s, ids, first);
  const anchor = moving.find((id) => pinSection(s.tabs[id]) === "tile") ?? moving[0]!;
  const folder: TileFolder = { id: newId("tf"), name: name.trim(), ...(name.trim() ? { renamedAt: Date.now() } : {}) };
  const before = after(s, first.windowId, anchor, moving);
  return { state: placing(s, moving, { pinned: true, row: false, beforeId: before, tileFolder: folder }), folderId: folder.id };
}

export function leaveTileFolder(s: BrowserState, ids: string[]): BrowserState {
  const first = s.tabs[ids[0] ?? ""];
  const folder = tileFolderOf(first);
  if (!first || !folder) return s;
  const moving = sameWindow(s, ids, first).filter((id) => tileFolderOf(s.tabs[id])?.id === folder.id);
  const last = folderMembers(s, first.windowId, folder.id).filter((id) => !moving.includes(id)).at(-1);
  return placing(s, moving, { pinned: true, row: false, beforeId: after(s, first.windowId, last, moving), tileFolder: null });
}

function patchMembers(s: BrowserState, windowId: string, folderId: string, folder: TileFolder | undefined): BrowserState {
  const members = folderMembers(s, windowId, folderId);
  if (!members.length) return s;
  const tabs = { ...s.tabs };
  for (const id of members) tabs[id] = withTileFolder(tabs[id]!, folder);
  return { ...s, tabs };
}

export function renameTileFolder(s: BrowserState, windowId: string, folderId: string, name: string): BrowserState {
  const folder = folderIn(s, windowId, folderId);
  if (!folder || folder.name === name.trim()) return s;
  return patchMembers(s, windowId, folderId, { id: folderId, name: name.trim(), renamedAt: Math.max(Date.now(), (folder.renamedAt ?? 0) + 1) });
}

export function dissolveTileFolder(s: BrowserState, windowId: string, folderId: string): BrowserState {
  return patchMembers(s, windowId, folderId, undefined);
}

function membersByWindow(tabs: Record<string, Tab>, windows: BrowserState["windows"], folders: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const w of Object.values(windows)) {
    for (const id of w.tabIds) {
      const folder = tileFolderOf(tabs[id]);
      if (!folder || !folders.has(folder.id)) continue;
      const key = `${w.id}\u0001${tabs[id]!.profileId}\u0001${folder.id}`;
      out.get(key)?.push(id) ?? out.set(key, [id]);
    }
  }
  return out;
}

const parkedFolders = (park: ParkedPins | undefined) => {
  const count = new Map<string, number>();
  for (const p of park?.tabs ?? []) if (p.tileFolder && !p.groupId && !p.pinnedAsRow) count.set(p.tileFolder.id, (count.get(p.tileFolder.id) ?? 0) + 1);
  return count;
};

function settleParked(s: BrowserState, prev: BrowserState): BrowserState["parkedPins"] | null {
  if (s.parkedPins === prev.parkedPins) return null;
  let out: BrowserState["parkedPins"] | null = null;
  for (const [profileId, park] of Object.entries(s.parkedPins)) {
    if (park === prev.parkedPins[profileId]) continue;
    const now = parkedFolders(park);
    const before = parkedFolders(prev.parkedPins[profileId]);
    const alone = new Set([...now].filter(([id, n]) => n === 1 && (before.get(id) ?? 0) >= 2).map(([id]) => id));
    if (!alone.size) continue;
    const tabs = park.tabs.map((p) => (p.tileFolder && alone.has(p.tileFolder.id) ? (({ tileFolder: _, ...rest }) => rest)(p) : p));
    (out ??= { ...s.parkedPins })[profileId] = { ...park, tabs };
  }
  return out;
}

export function settleTileFolders(s: BrowserState, prev: BrowserState): BrowserState | null {
  const parkedPins = settleParked(s, prev);
  if (s.tabs === prev.tabs) return parkedPins ? { ...s, parkedPins } : null;
  let tabs: Record<string, Tab> | null = null;
  const shrunk = new Set<string>();
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const now = s.tabs[id];
    const was = prev.tabs[id];
    const wasIn = tileFolderOf(was)?.id;
    const otherProfile = !!now && !!was && now.profileId !== was.profileId;
    const moved = otherProfile || (!!now && !!was && now.windowId !== was.windowId);
    if (now?.tileFolder && (!tileFolderOf(now) || otherProfile)) (tabs ??= { ...s.tabs })[id] = withTileFolder(now, undefined);
    const isIn = tileFolderOf((tabs ?? s.tabs)[id])?.id;
    if (wasIn && (isIn !== wasIn || moved)) shrunk.add(wasIn);
  }
  if (shrunk.size) {
    const current = tabs ?? s.tabs;
    const before = membersByWindow(prev.tabs, prev.windows, shrunk);
    for (const [key, ids] of membersByWindow(current, s.windows, shrunk)) {
      if (ids.length !== 1 || (before.get(key)?.length ?? 0) < 2) continue;
      (tabs ??= { ...s.tabs })[ids[0]!] = withTileFolder(current[ids[0]!]!, undefined);
    }
  }
  if (!tabs && !parkedPins) return null;
  return { ...s, ...(tabs ? { tabs } : {}), ...(parkedPins ? { parkedPins } : {}) };
}
