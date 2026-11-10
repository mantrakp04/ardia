import type { BookmarkDraft, RemovedBookmarks } from "./bookmarks";
import { folderChildren } from "./bookmarks";
import { useBrowser } from "../browser/store";

type BookmarkTree = BookmarkDraft & { children?: BookmarkTree[] };
type ClipboardValue = { kind: "copy"; trees: BookmarkTree[] } | { kind: "cut"; removed: RemovedBookmarks };

let clipboard: ClipboardValue | null = null;

function treesFor(ids: string[]): BookmarkTree[] {
  const b = useBrowser.getState().bookmarks;
  const selected = new Set(ids);
  const out: BookmarkTree[] = [];
  for (const id of ids) {
    if (ancestors(id).some((parent) => selected.has(parent))) continue;
    const node = b.nodes[id];
    if (!node) continue;
    if (node.kind === "url") out.push({ title: node.title, url: node.url, favicon: node.favicon, addedAt: node.addedAt });
    else out.push({ title: node.title, addedAt: node.addedAt, children: folderChildren(b, id).flatMap((child) => treesFor([child.id])) });
  }
  return out;
}

function ancestors(id: string): string[] {
  const b = useBrowser.getState().bookmarks;
  const out: string[] = [];
  let node = b.nodes[id];
  while (node?.parentId) {
    out.push(node.parentId);
    node = b.nodes[node.parentId];
  }
  return out;
}

export function copyBookmarkNodes(ids: string[]) {
  const trees = treesFor(ids);
  if (trees.length) clipboard = { kind: "copy", trees };
}

export function cutBookmarkNodes(ids: string[]) {
  if (!ids.length) return;
  const removed = useBrowser.getState().removeBookmarks(ids);
  if (removed.places.length) clipboard = { kind: "cut", removed };
}

export function pasteBookmarkNodes(profileId: string, parentId?: string, index?: number) {
  if (!clipboard) return [];
  const s = useBrowser.getState();
  if (clipboard.kind === "copy") return s.addBookmarkTree(profileId, clipboard.trees, parentId, index);
  const removed = clipboard.removed;
  if (removed.nodes.some((node) => s.bookmarks.nodes[node.id])) return [];
  s.insertBookmarkNodes(profileId, removed.nodes, removed.places, parentId, index);
  clipboard = null;
  return removed.places.map((place) => place.id);
}

export const hasBookmarkClipboard = () => clipboard !== null;
