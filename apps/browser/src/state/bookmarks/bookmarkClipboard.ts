import type { BookmarkDraft } from "./bookmarks";
import { folderChildren } from "./bookmarks";
import { useBrowser } from "../browser/store";

type ClipboardValue = { kind: "copy"; trees: BookmarkDraft[] } | { kind: "cut"; ids: string[] };

let clipboard: ClipboardValue | null = null;

function treesFor(ids: string[]): BookmarkDraft[] {
  const b = useBrowser.getState().bookmarks;
  const selected = new Set(ids);
  const out: BookmarkDraft[] = [];
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
  if (ids.some((id) => useBrowser.getState().bookmarks.nodes[id])) clipboard = { kind: "cut", ids: [...ids] };
}

export function pasteBookmarkNodes(profileId: string, parentId?: string, index?: number) {
  if (!clipboard) return [];
  const s = useBrowser.getState();
  if (clipboard.kind === "copy") return s.addBookmarkTree(profileId, clipboard.trees, parentId, index);
  const moved = s.moveBookmarkNodes(clipboard.ids, profileId, parentId, index);
  if (!moved.length) return [];
  clipboard = null;
  return moved;
}

export const hasBookmarkClipboard = () => clipboard !== null;
