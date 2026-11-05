import { confirm } from "../../platform/dialogs";
import { create } from "zustand";
import { focus, openWindow } from "../browser/actions";
import { bookmarkRoots, folderLinks, isWithin, ownerOfBookmark } from "./bookmarks";
import { storeAction, useBrowser } from "../browser/store";
import { activeTabId, bookmarkProfileId, resolveWindowId, tabTitle, viewTabIds } from "../browser/model";
import { originalProfile } from "../windows/small";
import { isWebPageUrl } from "../../lib/url";

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
  if (mode === "incognito") return void openWindow({ kind: "private", url, profileId: originalProfile(s, w) });
  if (!id || mode === "window") {
    const created = openWindow(w?.kind === "private" ? { kind: "private", url, profileId: originalProfile(s, w) } : { url, profileId: w?.profileId });
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

export type OpenAllMode = "tabs" | "window" | "incognito";

export const FOLDER_MANY = "This folder has a lot of bookmarks.";

export function openFolder(folderId: string, windowId: string | null | undefined, mode: OpenAllMode = "tabs") {
  return openLinks(folderLinks(useBrowser.getState().bookmarks, folderId), windowId, mode, FOLDER_MANY);
}

export async function openLinks(links: { url: string }[], windowId: string | null | undefined, mode: OpenAllMode = "tabs", manyMessage = "That's a lot of pages.") {
  const s = useBrowser.getState();
  if (!links.length) return;
  if (links.length > 15) {
    const { confirmed } = await confirm({
      title: `Open ${links.length} tabs?`,
      message: manyMessage,
      confirmTitle: "Open All",
      windowId: resolveWindowId(s, windowId),
    });
    if (!confirmed) return;
  }
  const id = resolveWindowId(s, windowId);
  const source = id ? s.windows[id] : undefined;
  if (mode !== "tabs" || !id) {
    const incognito = mode === "incognito" || source?.kind === "private";
    const created = openWindow({ url: links[0]!.url, kind: incognito ? "private" : "main", profileId: incognito ? undefined : source?.profileId });
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

export const profileOfBookmark = (id: string) => ownerOfBookmark(useBrowser.getState(), id);

export function bookmarkTab(windowId: string, tabId: string) {
  const s = useBrowser.getState();
  const id = windowId;
  const tab = s.tabs[tabId];
  if (!s.windows[id] || !tab?.url) return;
  const profileId = bookmarkProfileId(s, s.windows[id]);
  const roots = bookmarkRoots(s, profileId);
  const existing = Object.values(s.bookmarks.nodes).find(
    (n) => n.kind === "url" && n.url === tab.url && roots && isWithin(useBrowser.getState().bookmarks, n.id, [roots.bar, roots.other]),
  );
  const bookmarkId =
    existing?.id ?? s.addBookmark({ profileId, url: tab.url, title: tabTitle(tab), favicon: tab.favicon });
  useBookmarkDialog.setState({ open: { kind: "page", windowId: id, bookmarkId } });
}

export function bookmarkAllTabs(windowId: string | null | undefined) {
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  if (!id) return;
  const tabs = viewTabIds(s, id)
    .map((t) => s.tabs[t]!)
    .filter((t) => isWebPageUrl(t.url))
    .map((t) => ({ url: t.url, title: tabTitle(t) }));
  if (!tabs.length) return;
  useBookmarkDialog.setState({ open: { kind: "allTabs", windowId: id, profileId: bookmarkProfileId(s, s.windows[id]), tabs } });
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
