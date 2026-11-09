import { create } from "zustand";
import { readDocument, writeDocument } from "../../platform/documents";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { isFields } from "../../lib/decode";
import type { BaseEntry } from "./tree";

export type SharedFolder = { path: string; base: BaseEntry[]; addedAt: number };

export type SharedFolderSync = {
  state: "syncing" | "synced" | "waiting" | "paused" | "missing" | "error";
  waiting: number;
  error: string | null;
  at: number;
};

type SharedFoldersState = {
  folders: Record<string, Record<string, SharedFolder>>;
  sync: Record<string, SharedFolderSync>;
};

const DOC = "shared-folders.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };
const SAVE_DELAY_MS = 400;

const text = (v: unknown): v is string => typeof v === "string" && !!v;

function cleanBase(list: unknown[]): BaseEntry[] {
  return list.flatMap((e): BaseEntry[] => {
    if (!isFields(e) || !text(e.key) || !text(e.file) || typeof e.name !== "string") return [];
    if (e.kind === "dir") return [{ kind: "dir", key: e.key, file: e.file, name: e.name, children: cleanBase(Array.isArray(e.children) ? e.children : []) }];
    if (e.kind !== "link" || !text(e.url)) return [];
    return [{ kind: "link", key: e.key, file: e.file, name: e.name, url: e.url, id: text(e.id) ? e.id : null }];
  });
}

const validFolder = (f: unknown): f is SharedFolder => isFields(f) && text(f.path) && Array.isArray(f.base);

function load(): SharedFoldersState["folders"] {
  const doc = parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS);
  if (!doc || !isFields(doc.folders)) return {};
  const out: SharedFoldersState["folders"] = {};
  for (const [profileId, byKey] of Object.entries(doc.folders)) {
    if (!isFields(byKey)) continue;
    const kept = Object.fromEntries(
      Object.entries(byKey).flatMap(([key, f]) => (validFolder(f) ? [[key, { path: f.path, base: cleanBase(f.base), addedAt: typeof f.addedAt === "number" ? f.addedAt : 0 }]] : [])),
    ) as Record<string, SharedFolder>;
    if (Object.keys(kept).length) out[profileId] = kept;
  }
  return out;
}

export const useSharedFolders = create<SharedFoldersState>()(() => ({ folders: load(), sync: {} }));

const state = () => useSharedFolders.getState();

let timer: ReturnType<typeof setTimeout> | undefined;
const writeFolders = () => writeDocument(DOC, versionedJson({ folders: state().folders }, DOC_VERSION));

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    writeFolders();
  }, SAVE_DELAY_MS);
}

export async function saveFoldersNow() {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  writeFolders();
}

export const folderRef = (profileId: string, key: string) => `${profileId}\u0001${key}`;

export const sharedFolderOf = (profileId: string, key: string): SharedFolder | undefined => state().folders[profileId]?.[key];

export const boundFolders = () =>
  Object.entries(state().folders).flatMap(([profileId, byKey]) => Object.entries(byKey).map(([key, folder]) => ({ profileId, key, folder })));

function patchFolders(profileId: string, key: string, folder: SharedFolder | null) {
  const { folders } = state();
  const { [key]: _, ...others } = folders[profileId] ?? {};
  const mine = folder ? { ...others, [key]: folder } : others;
  const { [profileId]: __, ...rest } = folders;
  useSharedFolders.setState({ folders: Object.keys(mine).length ? { ...rest, [profileId]: mine } : rest });
  save();
}

export function bindFolder(profileId: string, key: string, path: string) {
  patchFolders(profileId, key, { path, base: [], addedAt: Date.now() });
}

export function unbindFolder(profileId: string, key: string) {
  if (!sharedFolderOf(profileId, key)) return;
  patchFolders(profileId, key, null);
  const { [folderRef(profileId, key)]: _, ...sync } = state().sync;
  useSharedFolders.setState({ sync });
}

export function setFolderBase(profileId: string, key: string, base: BaseEntry[]) {
  const folder = sharedFolderOf(profileId, key);
  if (folder) patchFolders(profileId, key, { ...folder, base });
}

export function setFolderSync(profileId: string, key: string, patch: Partial<SharedFolderSync>) {
  const ref = folderRef(profileId, key);
  const was = state().sync[ref] ?? { state: "syncing", waiting: 0, error: null, at: 0 };
  const next = { ...was, ...patch, at: Date.now() };
  if (was.state === next.state && was.waiting === next.waiting && was.error === next.error) return;
  useSharedFolders.setState({ sync: { ...state().sync, [ref]: next } });
}
