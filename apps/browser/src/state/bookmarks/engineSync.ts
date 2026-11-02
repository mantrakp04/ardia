import { applyBookmarkOps, bookmarkTree, onBookmarksChanged, watchBookmarks, type BookmarkOp, type EngineBookmark } from "../../platform/bookmarks";
import { readDocument, writeDocument } from "../../platform/documents";
import { parseSaved, versionedJson, type Migrations } from "../../lib/savedDocument";
import { bookmarkUuidFor, isBookmarkUuid, ROOT_TITLES, rootIdsFor } from "./bookmarks";
import { applyOps, bookmarkOps, flatFromEngine, flatFromStore, type Flat } from "./flatBookmarks";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import type { BookmarkFolder, BookmarkNode, Bookmarks } from "../browser/types";
import { engineProfiles } from "../profiles/engineProfiles";
import { migrateLegacyFile } from "../app/legacyFiles";

const LEGACY_FILE = "bookmarks.json";
type LegacyFile = { bookmarks?: { nodes: Bookmarks["nodes"]; roots: Record<string, { bar: string; other: string }> } };
const LEGACY_KEPT_MS = 10_000;
const CACHE_FILE = "bookmarks-cache.json";
const CACHE_SAVE_MS = 2000;
const store = () => useBrowser.getState();

export type { BookmarkOp, EngineBookmark };

type EngineState = {
  shadow: Flat | null;
  shown: Flat | null;
  busy: boolean;
  needRead: boolean;
  needPush: boolean;
};
const engines = new Map<string, EngineState>();
const stateOf = (engine: string) => {
  let state = engines.get(engine);
  if (!state) engines.set(engine, (state = { shadow: null, shown: null, busy: false, needRead: false, needPush: false }));
  return state;
};
let legacyMoved = false;

function adopt(engine: string, flat: Flat, { ready = legacyMoved } = {}) {
  useBrowser.setState((s) => {
    const roots = rootIdsFor(engine);
    const old = flatFromStore(s.bookmarks, engine);
    const nodes = { ...s.bookmarks.nodes };
    for (const id of old.nodes.keys()) delete nodes[id];
    for (const [id, n] of flat.nodes) {
      const was = s.bookmarks.nodes[id];
      const key = n.key ? { syncKey: n.key } : {};
      nodes[id] =
        n.kind === "url"
          ? { kind: "url", id, parentId: n.parent!, title: n.title, url: n.url ?? "", favicon: was?.kind === "url" ? was.favicon : null, addedAt: n.addedAt, ...key }
          : ({ kind: "folder", id, parentId: n.parent, title: n.title, children: flat.children.get(id) ?? [], addedAt: n.addedAt, ...key } satisfies BookmarkFolder);
    }
    nodes[roots.bar] = { ...(nodes[roots.bar] as BookmarkFolder), title: ROOT_TITLES.bar };
    nodes[roots.other] = { ...(nodes[roots.other] as BookmarkFolder), title: ROOT_TITLES.other };
    return {
      bookmarks: { ...s.bookmarks, nodes },
      ...(ready && !s.bookmarksReady[engine] ? { bookmarksReady: { ...s.bookmarksReady, [engine]: true as const } } : {}),
    };
  });
}

async function sendOps(engine: string, ops: BookmarkOp[]): Promise<boolean> {
  try {
    const result = await applyBookmarkOps(engine, ops);
    return !result.skipped && !result.invalid.length;
  } catch (error) {
    console.warn("[bookmarks] couldn't save to Chrome", error);
    return false;
  }
}

async function readTree(engine: string, state: EngineState) {
  await watchBookmarks(engine);
  const fetched = flatFromEngine(await bookmarkTree(engine), engine);
  const base = state.shadow ?? state.shown ?? flatFromStore({ nodes: {} }, engine);
  const edits = bookmarkOps(base, flatFromStore(store().bookmarks, engine), engine);
  const merged = edits.length ? applyOps(fetched, edits, engine) : fetched;
  state.shadow = fetched;
  state.shown = null;
  adopt(engine, merged);
  if (!edits.length) return;
  if (await sendOps(engine, edits)) state.shadow = merged;
  else state.needRead = true;
}

async function pushTree(engine: string, state: EngineState) {
  if (!state.shadow) return;
  const desired = flatFromStore(store().bookmarks, engine);
  if (!desired.nodes.size) return;
  const ops = bookmarkOps(state.shadow, desired, engine);
  if (!ops.length) return;
  if (await sendOps(engine, ops)) state.shadow = desired;
  else state.needRead = true;
}

function work(engine: string) {
  const state = stateOf(engine);
  if (state.busy) return;
  state.busy = true;
  void (async () => {
    try {
      while (state.needRead || state.needPush) {
        if (state.needRead) {
          state.needRead = false;
          state.needPush = false;
          await readTree(engine, state);
        } else {
          state.needPush = false;
          await pushTree(engine, state);
        }
      }
    } catch (error) {
      console.warn(`[bookmarks] couldn't read ${engine || "the default profile"}'s bookmarks`, error);
    } finally {
      state.busy = false;
    }
  })();
}

function read(engine: string) {
  stateOf(engine).needRead = true;
  work(engine);
}

function push(s: BrowserState) {
  for (const engine of engineProfiles(s)) {
    const state = stateOf(engine);
    if (!state.shadow) continue;
    state.needPush = true;
    work(engine);
  }
}

const CACHE_VERSION = 1;
const CACHE_MIGRATIONS: Migrations = {};

type CacheDoc = { trees: Record<string, BookmarkNode[]> };

const isFields = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isCachedNode = (n: unknown): n is BookmarkNode =>
  isFields(n) &&
  typeof n.id === "string" &&
  typeof n.title === "string" &&
  typeof n.addedAt === "number" &&
  ((n.kind === "url" && typeof n.url === "string" && typeof n.parentId === "string") ||
    (n.kind === "folder" && Array.isArray(n.children) && n.children.every((c) => typeof c === "string")));

function readCache(): CacheDoc["trees"] {
  const trees = parseSaved(readDocument(CACHE_FILE), CACHE_VERSION, CACHE_MIGRATIONS)?.trees;
  if (!isFields(trees)) return {};
  return Object.fromEntries(Object.entries(trees).flatMap(([engine, nodes]) => (Array.isArray(nodes) && nodes.every(isCachedNode) ? [[engine, nodes]] : [])));
}

function launchTrees(): Record<string, Flat> {
  const out: Record<string, Flat> = {};
  for (const [engine, nodes] of Object.entries(readCache())) {
    const roots = rootIdsFor(engine);
    const b: Bookmarks = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) };
    if (b.nodes[roots.bar] && b.nodes[roots.other]) out[engine] = flatFromStore(b, engine);
  }
  if (Object.keys(out).length) return out;
  try {
    const legacy = (JSON.parse(readDocument(LEGACY_FILE) ?? "null") as LegacyFile | null)?.bookmarks;
    const s = store();
    const uuids = new Map<string, string>();
    const uuidOf = (old: string) => {
      let uuid = uuids.get(old);
      if (uuid === undefined) uuids.set(old, (uuid = bookmarkUuidFor(old)));
      return uuid;
    };
    for (const [profileId, roots] of Object.entries(legacy?.roots ?? {})) {
      if (!s.profiles[profileId] || isIncognitoProfile(profileId)) continue;
      const engine = engineProfile(s, profileId);
      if (out[engine]) continue;
      const ids = rootIdsFor(engine);
      const id = (old: string) => (old === roots.bar ? ids.bar : old === roots.other ? ids.other : uuidOf(old));
      const nodes: Bookmarks["nodes"] = {};
      for (const n of Object.values(legacy!.nodes)) {
        const mapped = { ...n, id: id(n.id), parentId: n.parentId === null ? null : id(n.parentId) } as BookmarkNode;
        nodes[mapped.id] = mapped.kind === "folder" ? { ...mapped, children: mapped.children.map(id) } : mapped;
      }
      out[engine] = flatFromStore({ nodes }, engine);
    }
  } catch {}
  return out;
}

let cacheTimer: ReturnType<typeof setTimeout> | undefined;

function saveCache() {
  cacheTimer = undefined;
  const s = store();
  const trees: CacheDoc["trees"] = {};
  for (const [engine, state] of engines) {
    if (!state.shadow || !engineProfiles(s).includes(engine)) continue;
    trees[engine] = [...flatFromStore(s.bookmarks, engine).nodes.keys()].map((id) => s.bookmarks.nodes[id]!);
  }
  try {
    writeDocument(CACHE_FILE, versionedJson({ trees } satisfies CacheDoc, CACHE_VERSION));
  } catch (error) {
    console.warn(`[bookmarks] couldn't save ${CACHE_FILE}`, error);
  }
}

export const migrateBookmarksFile = ({ keepMs = LEGACY_KEPT_MS } = {}) => migrateLegacyFile(LEGACY_FILE, "bookmarks", moveBookmarks, keepMs);

async function moveBookmarks(file: LegacyFile) {
  const b = file.bookmarks ?? { nodes: {}, roots: {} };
  const s = store();
  const done = new Set<string>();
  for (const [profileId, roots] of Object.entries(b.roots ?? {})) {
    if (!s.profiles[profileId] || isIncognitoProfile(profileId)) continue;
    const engine = engineProfile(s, profileId);
    if (done.has(engine)) continue;
    done.add(engine);
    const ops: BookmarkOp[] = [];
    const seen = new Set<string>();
    const walk = (folderId: string, parent: string) => {
      const folder = b.nodes[folderId];
      if (folder?.kind !== "folder") return;
      folder.children.forEach((childId, index) => {
        const node: BookmarkNode | undefined = b.nodes[childId];
        if (!node || seen.has(node.id)) return;
        seen.add(node.id);
        const id = bookmarkUuidFor(node.id);
        const key = node.syncKey ?? (isBookmarkUuid(node.id) ? undefined : node.id);
        const common = { op: "add" as const, id, t: node.title, a: node.addedAt, ...(key ? { key } : {}), parent, index, ifAbsent: true };
        ops.push(node.kind === "url" ? { ...common, k: "u", u: node.url } : { ...common, k: "f" });
        if (node.kind === "folder") walk(node.id, id);
      });
    };
    walk(roots.bar, "bar");
    walk(roots.other, "other");
    if (!ops.length) continue;
    const result = await applyBookmarkOps(engine, ops);
    if (result.skipped) throw new Error(`${result.skipped} of ${ops.length} bookmarks couldn't be added`);
  }
}

export function startBookmarks() {
  for (const [engine, flat] of Object.entries(launchTrees())) {
    if (!engineProfiles(store()).includes(engine)) continue;
    stateOf(engine).shown = flat;
    adopt(engine, flat, { ready: false });
  }
  const changes = onBookmarksChanged((engine) => {
    if (stateOf(engine).shadow) read(engine);
  });
  let stopped = false;
  void migrateBookmarksFile().then((result) => {
    legacyMoved = result !== "kept";
    if (!stopped) for (const engine of engineProfiles(store())) read(engine);
  });
  const stop = useBrowser.subscribe((s, prev) => {
    if (s.profiles !== prev.profiles) {
      for (const engine of engineProfiles(s)) if (!stateOf(engine).shadow && !stateOf(engine).busy) read(engine);
    }
    if (s.bookmarks !== prev.bookmarks) {
      push(s);
      if ([...engines.values()].some((e) => e.shadow)) cacheTimer ??= setTimeout(saveCache, CACHE_SAVE_MS);
    }
  });
  return () => {
    stopped = true;
    clearTimeout(cacheTimer);
    if (cacheTimer) saveCache();
    cacheTimer = undefined;
    changes.remove();
    stop();
    engines.clear();
    legacyMoved = false;
  };
}

export async function reloadBookmarks() {
  for (const engine of engineProfiles(store())) read(engine);
  for (let i = 0; i < 200 && [...engines.values()].some((e) => e.busy); i++) await new Promise((r) => setTimeout(r, 5));
}
