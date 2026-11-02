import type { Adapter, Extraction } from "../../platform/sync";
import { tileFolderOf, withTileFolder } from "../pins/tileFolders";
import type { Tab, TileFolder } from "../browser/types";
import { PIN_TAB, FOLDER_NAME, syncedFolderId, syncedName, TILE_FOLDER, type FolderNameValue, type TileFolderValue } from "./pinRecords";
import { commitPinnedEdit, homeWindow, openWindows, store, unpinnedRemotely, windowsHomeFirst } from "./pinnedSyncState";
import { pinKeyOf, pinSection } from "../browser/model";

const localFolders = new Map<string, Set<string>>();

export function tileFoldersAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(TILE_FOLDER.length);
  return {
    prefix: TILE_FOLDER,
    extract: (base, _queued, _now, recorded, remote) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const local = new Map<string, TileFolder>();
      const mark = (key: string, folder: TileFolder | undefined) => {
        known.add(key);
        if (!folder) return;
        values.set(`${TILE_FOLDER}${key}`, { f: folder.id } satisfies TileFolderValue);
        const was = local.get(folder.id);
        if (!was || (folder.renamedAt ?? -1) > (was.renamedAt ?? -1)) local.set(folder.id, folder);
      };
      const unpinned = unpinnedRemotely(recorded, remote);
      const home = homeWindow(s, profileId);
      for (const w of windowsHomeFirst(s, home)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (t?.pin && t.profileId === profileId && !known.has(pinKeyOf(t))) mark(pinKeyOf(t), tileFolderOf(t));
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) if (!p.groupId && !known.has(p.id)) mark(p.id, tileFolderOf(p));
      for (const [folderId, folder] of local) {
        const synced = base(`${FOLDER_NAME}${folderId}`);
        if (folder.renamedAt !== undefined && syncedName(synced) !== folder.name) values.set(`${FOLDER_NAME}${folderId}`, { n: folder.name } satisfies FolderNameValue);
        else if (synced !== undefined) values.set(`${FOLDER_NAME}${folderId}`, synced);
      }
      const had = localFolders.get(profileId) ?? new Set();
      localFolders.set(profileId, new Set(local.keys()));
      const ignore = (k: string) => {
        if (k.startsWith(FOLDER_NAME)) return !had.has(k.slice(FOLDER_NAME.length));
        return !known.has(keyOf(k)) && base(`${PIN_TAB}${keyOf(k)}`) === undefined && !unpinned(keyOf(k));
      };
      return { values, ignore } satisfies Extraction;
    },
    apply: (visible, changed) => {
      const s = store();
      const touched = new Set([...changed].filter((k) => !k.startsWith(FOLDER_NAME)).map(keyOf));
      const names = new Map<string, string>();
      for (const [k, v] of visible) {
        const name = k.startsWith(FOLDER_NAME) ? syncedName(v) : undefined;
        if (name !== undefined) names.set(k.slice(FOLDER_NAME.length), name);
      }
      const wanted = (key: string, current: TileFolder | undefined): TileFolder | undefined => {
        const id = touched.has(key) ? syncedFolderId(visible.get(`${TILE_FOLDER}${key}`)) : current?.id;
        if (!id) return undefined;
        const name = names.get(id);
        if (current?.id === id && (name === undefined || name === current.name)) return current;
        return { id, name: name ?? (current?.id === id ? current.name : "") };
      };
      let tabs: Record<string, Tab> | null = null;
      for (const w of openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (pinSection(t) !== "tile" || t!.profileId !== profileId) continue;
          const folder = wanted(pinKeyOf(t!), tileFolderOf(t));
          if (folder !== tileFolderOf(t)) (tabs ??= { ...s.tabs })[id] = withTileFolder(t!, folder);
        }
      }
      const park = s.parkedPins[profileId];
      const parked = park?.tabs.map((p) => {
        if (p.groupId || pinSection(p) !== "tile") return p;
        const folder = wanted(p.id, tileFolderOf(p));
        return folder === tileFolderOf(p) ? p : withTileFolder(p, folder);
      });
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!tabs && !parkEdited) return true;
      commitPinnedEdit(s, profileId, tabs ? { tabs } : {}, parkEdited ? { tabs: parked! } : null);
      return true;
    },
  };
}
