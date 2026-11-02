import type { StateCreator } from "zustand";
import { LEGACY_BOOKMARK_SEED } from "../../lib/legacy";
import type { BrowserState } from "../browser/store";
import { engineProfile, without } from "../browser/model";
import type { BookmarkFolder, BookmarkNode, Bookmarks } from "../browser/types";

export type BookmarksSlice = {
  bookmarks: Bookmarks;
  bookmarksReady: Record<string, true>;

  addBookmark(options: { profileId: string; url: string; title: string; favicon?: string | null; parentId?: string; index?: number }): string;
  addBookmarkFolder(options: { profileId: string; title: string; parentId?: string; index?: number }): string;
  updateBookmark(id: string, patch: { title?: string; url?: string; favicon?: string | null }): void;
  moveBookmark(id: string, parentId: string, index?: number): void;
  removeBookmark(id: string): void;
  toggleBookmark(profileId: string, page: { url: string; title: string; favicon: string | null }): boolean;
  addBookmarkTree(profileId: string, drafts: BookmarkDraft[], parentId?: string, index?: number): string[];
  removeBookmarks(ids: string[]): RemovedBookmarks;
  restoreBookmarks(removed: RemovedBookmarks): void;
};

export type BookmarkDraft = { title: string; url?: string; addedAt?: number; children?: BookmarkDraft[] };

export type RemovedBookmarks = { nodes: BookmarkNode[]; places: { id: string; parentId: string; index: number }[] };

const EMPTY_BOOKMARKS: Bookmarks = { nodes: {} };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isBookmarkUuid = (id: string) => UUID.test(id);

function uuidFrom(words: number[]): string {
  const hex = words.map((w) => (w >>> 0).toString(16).padStart(8, "0")).join("");
  const v = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${v}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const newBookmarkId = () => uuidFrom(Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x1_0000_0000)));

export function bookmarkUuidFor(id: string): string {
  if (isBookmarkUuid(id)) return id;
  const text = `${LEGACY_BOOKMARK_SEED}${id}`;
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return uuidFrom([h1, h2, h3, h4]);
}

export const rootIdsFor = (engine: string) => ({ bar: `bar@${engine || "default"}`, other: `other@${engine || "default"}` });

export const ROOT_TITLES = { bar: "Bookmarks Bar", other: "Other Bookmarks" } as const;

const MAX_DEPTH = 64;

export function isWithin(b: Bookmarks, id: string, ancestors: readonly string[]): boolean {
  let node = b.nodes[id];
  for (let i = 0; node && i < MAX_DEPTH; i++) {
    if (ancestors.includes(node.id)) return true;
    node = node.parentId ? b.nodes[node.parentId] : undefined;
  }
  return false;
}

export type BookmarkRootIds = { bar: string; other: string };

export type BookmarkOwners = Pick<BrowserState, "bookmarks" | "profiles" | "profileOrder">;

export function engineBookmarkRoots(b: Bookmarks, engine: string): BookmarkRootIds | null {
  const roots = rootIdsFor(engine);
  return b.nodes[roots.bar] && b.nodes[roots.other] ? roots : null;
}

export const bookmarkRoots = (s: Pick<BrowserState, "bookmarks" | "profiles">, profileId: string) =>
  engineBookmarkRoots(s.bookmarks, engineProfile(s, profileId));

export function ownerOfBookmark(s: BookmarkOwners, id: string): string | null {
  let node = s.bookmarks.nodes[id];
  for (let i = 0; node?.parentId && i < MAX_DEPTH; i++) node = s.bookmarks.nodes[node.parentId];
  const root = node;
  if (!root) return null;
  return s.profileOrder.find((p) => {
    const roots = bookmarkRoots(s, p);
    return roots?.bar === root.id || roots?.other === root.id;
  }) ?? null;
}

export function ensureRoots(b: Bookmarks, engine: string): [Bookmarks, BookmarkRootIds] {
  const roots = rootIdsFor(engine);
  if (b.nodes[roots.bar] && b.nodes[roots.other]) return [b, roots];
  const nodes = { ...b.nodes };
  nodes[roots.bar] ??= { kind: "folder", id: roots.bar, parentId: null, title: ROOT_TITLES.bar, children: [], addedAt: 0 };
  nodes[roots.other] ??= { kind: "folder", id: roots.other, parentId: null, title: ROOT_TITLES.other, children: [], addedAt: 0 };
  return [{ ...b, nodes }, roots];
}

function subtree(b: Bookmarks, ids: string[]): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const node = b.nodes[id];
    if (!node) return;
    out.push(id);
    if (node.kind === "folder") node.children.forEach(walk);
  };
  ids.forEach(walk);
  return out;
}

export function removeBookmarkTree(b: Bookmarks, ids: string[]): Bookmarks {
  const gone = new Set(subtree(b, ids));
  const nodes = without(b.nodes, gone);
  for (const node of Object.values(nodes)) {
    if (node.kind === "folder" && node.children.some((c) => gone.has(c))) {
      nodes[node.id] = { ...node, children: node.children.filter((c) => !gone.has(c)) };
    }
  }
  return { ...b, nodes };
}

const urlIndex = new WeakMap<Bookmarks, Map<string, Map<string, string[]>>>();

export function bookmarksByUrl(b: Bookmarks, engine: string): Map<string, string[]> {
  let perEngine = urlIndex.get(b);
  if (!perEngine) urlIndex.set(b, (perEngine = new Map()));
  let index = perEngine.get(engine);
  if (index) return index;
  index = new Map();
  const roots = engineBookmarkRoots(b, engine);
  for (const id of roots ? subtree(b, [roots.bar, roots.other]) : []) {
    const node = b.nodes[id];
    if (node?.kind === "url") index.set(node.url, [...(index.get(node.url) ?? []), id]);
  }
  perEngine.set(engine, index);
  return index;
}

export const isBookmarked = (s: Pick<BrowserState, "bookmarks" | "profiles">, profileId: string, url: string) =>
  !!url && bookmarksByUrl(s.bookmarks, engineProfile(s, profileId)).has(url);

export function folderChildren(b: Bookmarks, folderId: string): BookmarkNode[] {
  const folder = b.nodes[folderId];
  return folder?.kind === "folder" ? folder.children.map((id) => b.nodes[id]).filter((n): n is BookmarkNode => !!n) : [];
}

function insertChild(b: Bookmarks, node: BookmarkNode, parentId: string, index?: number): Bookmarks {
  const parent = b.nodes[parentId];
  if (parent?.kind !== "folder") return b;
  const children = parent.children.filter((c) => c !== node.id);
  children.splice(Math.min(index ?? children.length, children.length), 0, node.id);
  return { ...b, nodes: { ...b.nodes, [node.id]: { ...node, parentId } as BookmarkNode, [parentId]: { ...parent, children } } };
}

export function bookmarkAncestors(b: Bookmarks, id: string): BookmarkFolder[] {
  const out: BookmarkFolder[] = [];
  let node = b.nodes[id];
  for (let i = 0; node?.parentId && i < MAX_DEPTH; i++) {
    const parent = b.nodes[node.parentId];
    if (parent?.kind !== "folder") break;
    out.push(parent);
    node = parent;
  }
  return out;
}

export function folderLinks(b: Bookmarks, folderId: string): Extract<BookmarkNode, { kind: "url" }>[] {
  return folderChildren(b, folderId).flatMap((n) => (n.kind === "url" ? [n] : folderLinks(b, n.id)));
}

export const createBookmarksSlice: StateCreator<BrowserState, [], [], BookmarksSlice> = (set, get) => ({
  bookmarks: EMPTY_BOOKMARKS,
  bookmarksReady: {},

  addBookmark({ profileId, url, title, favicon = null, parentId, index }) {
    const [b, roots] = ensureRoots(get().bookmarks, engineProfile(get(), profileId));
    const node: BookmarkNode = { kind: "url", id: newBookmarkId(), parentId: parentId ?? roots.bar, title, url, favicon, addedAt: Date.now() };
    set({ bookmarks: insertChild(b, node, node.parentId, index) });
    return node.id;
  },

  addBookmarkFolder({ profileId, title, parentId, index }) {
    const [b, roots] = ensureRoots(get().bookmarks, engineProfile(get(), profileId));
    const node: BookmarkNode = { kind: "folder", id: newBookmarkId(), parentId: parentId ?? roots.bar, title, children: [], addedAt: Date.now() };
    set({ bookmarks: insertChild(b, node, node.parentId!, index) });
    return node.id;
  },

  updateBookmark(id, patch) {
    set((s) => {
      const node = s.bookmarks.nodes[id];
      if (!node) return {};
      const next = node.kind === "url" ? { ...node, ...patch } : { ...node, ...(patch.title !== undefined ? { title: patch.title } : {}) };
      return { bookmarks: { ...s.bookmarks, nodes: { ...s.bookmarks.nodes, [id]: next } } };
    });
  },

  moveBookmark(id, parentId, index) {
    set((s) => {
      const node = s.bookmarks.nodes[id];
      if (!node || node.parentId === null || subtree(s.bookmarks, [id]).includes(parentId)) return {};
      const oldParent = s.bookmarks.nodes[node.parentId];
      let b = s.bookmarks;
      if (oldParent?.kind === "folder") {
        b = { ...b, nodes: { ...b.nodes, [oldParent.id]: { ...oldParent, children: oldParent.children.filter((c) => c !== id) } } };
      }
      return { bookmarks: insertChild(b, node, parentId, index) };
    });
  },

  removeBookmark(id) {
    set((s) => {
      const node = s.bookmarks.nodes[id];
      if (!node || node.parentId === null) return {};
      return { bookmarks: removeBookmarkTree(s.bookmarks, [id]) };
    });
  },

  addBookmarkTree(profileId, drafts, parentId, index) {
    const [b, roots] = ensureRoots(get().bookmarks, engineProfile(get(), profileId));
    const nodes = { ...b.nodes };
    const build = (d: BookmarkDraft, parent: string): string => {
      const id = newBookmarkId();
      const addedAt = d.addedAt ?? Date.now();
      if (d.url !== undefined && !d.children) {
        nodes[id] = { kind: "url", id, parentId: parent, title: d.title, url: d.url, favicon: null, addedAt };
      } else {
        nodes[id] = { kind: "folder", id, parentId: parent, title: d.title, children: [], addedAt };
        (nodes[id] as BookmarkFolder).children = (d.children ?? []).map((c) => build(c, id));
      }
      return id;
    };
    const target = parentId && b.nodes[parentId]?.kind === "folder" ? parentId : roots.bar;
    const ids = drafts.map((d) => build(d, target));
    const parent = nodes[target] as BookmarkFolder;
    const children = [...parent.children];
    children.splice(Math.min(index ?? children.length, children.length), 0, ...ids);
    nodes[target] = { ...parent, children };
    set({ bookmarks: { ...b, nodes } });
    return ids;
  },

  removeBookmarks(ids) {
    const b = get().bookmarks;
    const removable = ids.filter((id) => b.nodes[id]?.parentId);
    const tops = removable.filter((id) => !bookmarkAncestors(b, id).some((a) => removable.includes(a.id)));
    const places = tops.map((id) => {
      const parentId = b.nodes[id]!.parentId!;
      const parent = b.nodes[parentId];
      return { id, parentId, index: parent?.kind === "folder" ? parent.children.indexOf(id) : 0 };
    });
    const nodes = subtree(b, tops).map((id) => b.nodes[id]!);
    if (tops.length) set({ bookmarks: removeBookmarkTree(b, tops) });
    return { nodes, places };
  },

  restoreBookmarks({ nodes, places }) {
    set((s) => {
      const next = { ...s.bookmarks.nodes };
      for (const n of nodes) next[n.id] = n;
      for (const p of [...places].sort((a, b) => a.index - b.index)) {
        const parent = next[p.parentId];
        if (parent?.kind !== "folder") {
          delete next[p.id];
          continue;
        }
        const children = parent.children.filter((c) => c !== p.id);
        children.splice(Math.min(p.index, children.length), 0, p.id);
        next[p.parentId] = { ...parent, children };
      }
      return { bookmarks: { ...s.bookmarks, nodes: next } };
    });
  },

  toggleBookmark(profileId, page) {
    const s = get();
    if (!page.url) return false;
    const existing = bookmarksByUrl(s.bookmarks, engineProfile(s, profileId)).get(page.url);
    if (existing?.length) {
      set({ bookmarks: removeBookmarkTree(s.bookmarks, existing) });
      return false;
    }
    get().addBookmark({ profileId, url: page.url, title: page.title, favicon: page.favicon });
    return true;
  },
});
