import { confirm } from "../../platform/dialogs";
import { create } from "zustand";
import { focus, openWindow } from "../browser/actions";
import { folderLinks } from "./bookmarks";
import { storeAction, useBrowser } from "../browser/store";
import { activeTabId, bookmarkProfileId, resolveWindowId, viewTabIds } from "../browser/model";
import { originalProfile } from "../windows/small";

type OpenMode = "current" | "background" | "foreground" | "window" | "incognito" | "split";

export function openModeFor(e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }): OpenMode {
  if (e.metaKey || e.middle) return e.shiftKey ? "foreground" : "background";
  if (e.altKey) return "split";
  if (e.shiftKey) return "window";
  return "current";
}

export function openUrl(url: string, windowId: string | null | undefined, mode: OpenMode) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  const w = id ? s.windows[id] : undefined;
  if (mode === "incognito") return void openWindow({ incognito: true, url, profileId: originalProfile(s, w) });
  if (!id || mode === "window") {
    const created = openWindow(w?.incognito ? { incognito: true, url, profileId: originalProfile(s, w) } : { url, profileId: w?.profileId });
    return focus(created);
  }
  const tabId = activeTabId(s, id);
  if (mode === "split") {
    const result = s.openSplitPane(id, { url });
    if (result.ok) return;
    return void s.newTab(id, { url });
  }
  if (mode === "current" && tabId) return s.navigate(tabId, url);
  s.newTab(id, { url, background: mode === "background", openerId: mode === "background" ? tabId : undefined });
}

export async function openFolder(folderId: string, windowId: string | null | undefined, mode: "tabs" | "window" | "incognito" = "tabs") {
  const s = useBrowser.getState();
  const links = folderLinks(s.bookmarks, folderId);
  if (!links.length) return;
  if (links.length > 15) {
    const { confirmed } = await confirm({
      title: `Open ${links.length} tabs?`,
      message: "This folder has a lot of bookmarks.",
      confirmTitle: "Open All",
      windowId: resolveWindowId(s, windowId),
    });
    if (!confirmed) return;
  }
  const id = resolveWindowId(s, windowId);
  const source = id ? s.windows[id] : undefined;
  if (mode !== "tabs" || !id) {
    const incognito = mode === "incognito" || !!source?.incognito;
    const created = openWindow({ url: links[0]!.url, incognito, profileId: incognito ? undefined : source?.profileId });
    openInOrder(created, links.slice(1), activeTabId(useBrowser.getState(), created));
    return focus(created);
  }
  const first = useBrowser.getState().newTab(id, { url: links[0]!.url });
  openInOrder(id, links.slice(1), first);
}

function openInOrder(windowId: string, links: { url: string }[], after: string | undefined) {
  for (const link of links) {
    const tabIds = useBrowser.getState().windows[windowId]?.tabIds ?? [];
    const index = after && tabIds.includes(after) ? tabIds.indexOf(after) + 1 : undefined;
    after = useBrowser.getState().newTab(windowId, { url: link.url, background: true, index }) || after;
  }
}

export type BookmarkDialogState =
  | { kind: "page"; windowId: string; bookmarkId: string }
  | { kind: "allTabs"; windowId: string; profileId: string; tabs: { url: string; title: string }[] };

export const useBookmarkDialog = create<{ open: BookmarkDialogState | null }>()(() => ({ open: null }));

export const closeBookmarkDialog = () => useBookmarkDialog.setState({ open: null });

export function profileOfBookmark(id: string): string | null {
  const b = useBrowser.getState().bookmarks;
  let node = b.nodes[id];
  for (let i = 0; node?.parentId && i < 64; i++) node = b.nodes[node.parentId];
  if (!node) return null;
  return Object.entries(b.roots).find(([, r]) => r.bar === node!.id || r.other === node!.id)?.[0] ?? null;
}

export function bookmarkTab(windowId: string, tabId: string) {
  const s = useBrowser.getState();
  const id = windowId;
  const tab = s.tabs[tabId];
  if (!s.windows[id] || !tab?.url) return;
  const profileId = bookmarkProfileId(s, s.windows[id]);
  const roots = s.bookmarks.roots[profileId];
  const existing = Object.values(s.bookmarks.nodes).find(
    (n) => n.kind === "url" && n.url === tab.url && roots && isUnder(n.id, [roots.bar, roots.other]),
  );
  const bookmarkId =
    existing?.id ?? s.addBookmark({ profileId, url: tab.url, title: tab.customTitle || tab.title || tab.url, favicon: tab.favicon });
  useBookmarkDialog.setState({ open: { kind: "page", windowId: id, bookmarkId } });
}

export function bookmarkAllTabs(windowId: string | null | undefined) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  if (!id) return;
  const tabs = viewTabIds(s, id)
    .map((t) => s.tabs[t]!)
    .filter((t) => /^(https?|file):/.test(t.url))
    .map((t) => ({ url: t.url, title: t.customTitle || t.title || t.url }));
  if (!tabs.length) return;
  useBookmarkDialog.setState({ open: { kind: "allTabs", windowId: id, profileId: bookmarkProfileId(s, s.windows[id]), tabs } });
}

function isUnder(id: string, roots: string[]): boolean {
  const { nodes } = useBrowser.getState().bookmarks;
  let node = nodes[id];
  for (let i = 0; node && i < 64; i++) {
    if (roots.includes(node.id)) return true;
    node = node.parentId ? nodes[node.parentId] : undefined;
  }
  return false;
}

export const addBookmark = storeAction("addBookmark");
export const addBookmarkFolder = storeAction("addBookmarkFolder");
export const updateBookmark = storeAction("updateBookmark");
export const moveBookmark = storeAction("moveBookmark");
export const removeBookmark = storeAction("removeBookmark");
export const toggleBookmark = storeAction("toggleBookmark");
export const addBookmarkTree = storeAction("addBookmarkTree");
export const removeBookmarks = storeAction("removeBookmarks");
export const restoreBookmarks = storeAction("restoreBookmarks");

export function toggleBookmarkOfTab(windowId: string, tabId: string) {
  const s = useBrowser.getState();
  const page = s.tabs[tabId];
  if (page) s.toggleBookmark(bookmarkProfileId(s, s.windows[windowId]), page);
}
