import { cleanUrl } from "@ardia/core";
import { copyText } from "../../platform/clipboard";
import { prompt } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import { addFolderToSidebar, makesGroup, restorableArcHolder, restoreArcFolders } from "./bookmarkGroups";
import { folderChildren, folderLinks } from "./bookmarks";
import { addBookmarkFolder, openFolder, openUrl, removeBookmark } from "./actions";
import { editBookmark } from "./edit";
import { currentBookmarks, currentSettings } from "../browser/current";
import type { BookmarkNode } from "../browser/types";
import { openInternalPage } from "../pages/urls";
import { updateSettings } from "../settings/actions";

export type ClickMods = { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

export async function openImportButtonMenu() {
  const choice = await showMenu([{ id: "hide", title: "Hide Import Bookmarks Button" }]);
  if (choice === "hide") updateSettings({ hideBookmarksBarImport: true });
}

export async function openFolderMenu(windowId: string, ids: string[], _e?: ClickMods, folderId?: string) {
  const b = currentBookmarks();
  const build = (list: string[], parent?: string, depth = 0): MenuItem[] => {
    const items: MenuItem[] = list
      .map((id) => b.nodes[id])
      .filter((n): n is BookmarkNode => !!n)
      .map((n) =>
        n.kind === "url"
          ? { id: `open:${n.id}`, title: n.title || n.url, symbol: "globe" }
          : { id: `folder:${n.id}`, title: n.title, symbol: "folder", children: depth < 8 ? build(n.children, n.id, depth + 1) : [] },
      );
    if (!items.length) items.push({ id: "empty", title: "Empty", enabled: false });
    const links = parent ? folderLinks(b, parent).length : 0;
    if (links > 0) {
      items.push(
        { separator: true },
        { id: `openAll:${parent}`, title: `Open All (${links})` },
        { id: `openAllWindow:${parent}`, title: "Open All in New Window" },
        { id: `openAllIncognito:${parent}`, title: "Open All in Incognito Window" },
        { id: `addGroup:${parent}`, title: "Add to Sidebar as Group", enabled: !!parent && makesGroup({ bookmarks: currentBookmarks() }, parent) },
      );
    }
    return items;
  };
  const choice = await showMenu(build(ids, folderId));
  if (!choice) return;
  const [action, id] = splitChoice(choice);
  const node = id ? currentBookmarks().nodes[id] : undefined;
  if (action === "open" && node?.kind === "url") openUrl(node.url, windowId, "current");
  if (action === "openAll" && id) void openFolder(id, windowId, "tabs");
  if (action === "openAllWindow" && id) void openFolder(id, windowId, "window");
  if (action === "openAllIncognito" && id) void openFolder(id, windowId, "incognito");
  if (action === "addGroup" && id) addFolderToSidebar(id, windowId);
}

const splitChoice = (choice: string): [string, string] => {
  const i = choice.indexOf(":");
  return i < 0 ? [choice, ""] : [choice.slice(0, i), choice.slice(i + 1)];
};

export async function openBarMenu(windowId: string, profileId: string, node: BookmarkNode | null) {
  const s = { bookmarks: currentBookmarks() };
  const barMode = currentSettings().bookmarksBar;
  const items: MenuItem[] = [];
  if (node?.kind === "url") {
    items.push(
      { id: "tab", title: "Open in New Tab" },
      { id: "window", title: "Open in New Window" },
      { id: "incognito", title: "Open in Incognito Window" },
      { id: "split", title: "Open in Split View" },
      { separator: true },
      { id: "edit", title: "Edit…" },
      { id: "copy", title: "Copy Link" },
      { id: "delete", title: "Delete" },
      { separator: true },
    );
  } else if (node?.kind === "folder") {
    const n = folderLinks(s.bookmarks, node.id).length;
    items.push(
      { id: "openAll", title: `Open All (${n})`, enabled: n > 0 },
      { id: "openAllWindow", title: "Open All in New Window", enabled: n > 0 },
      { id: "openAllIncognito", title: "Open All in Incognito Window", enabled: n > 0 },
      { id: "addGroup", title: "Add to Sidebar as Group", enabled: makesGroup(s, node.id) },
      ...(restorableArcHolder(s, node.id) ? [{ id: "restoreArc", title: "Restore Arc Folders as Groups" }] : []),
      { separator: true },
      { id: "rename", title: "Rename…" },
      { id: "delete", title: "Delete" },
      { separator: true },
    );
  }
  items.push(
    { id: "addPage", title: "Add Page…" },
    { id: "addFolder", title: "Add Folder…" },
    { separator: true },
    { id: "manage", title: "Manage Bookmarks" },
    {
      id: "show",
      title: "Show Bookmarks Bar",
      children: [
        { id: "bar:always", title: "Always", checked: barMode === "always" },
        { id: "bar:newTab", title: "On New Tab Only", checked: barMode === "newTab" },
        { id: "bar:never", title: "Never", checked: barMode === "never" },
      ],
    },
  );
  const choice = await showMenu(items);
  if (!choice) return;
  const bar = s.bookmarks.roots[profileId]?.bar;
  if (node?.kind === "url") {
    if (choice === "tab") openUrl(node.url, windowId, "foreground");
    if (choice === "window") openUrl(node.url, windowId, "window");
    if (choice === "incognito") openUrl(node.url, windowId, "incognito");
    if (choice === "split") openUrl(node.url, windowId, "split");
    if (choice === "edit") void editBookmark(node.id, windowId);
    if (choice === "copy") copyText(cleanUrl(node.url));
  }
  if (node?.kind === "folder") {
    if (choice === "openAll") void openFolder(node.id, windowId, "tabs");
    if (choice === "openAllWindow") void openFolder(node.id, windowId, "window");
    if (choice === "openAllIncognito") void openFolder(node.id, windowId, "incognito");
    if (choice === "rename") void editBookmark(node.id, windowId);
    if (choice === "addGroup") addFolderToSidebar(node.id, windowId);
    if (choice === "restoreArc") restoreArcFolders(node.id, windowId);
  }
  if (choice === "delete" && node) removeBookmark(node.id);
  const parentId = node?.parentId ?? bar;
  const index = node && parentId ? (folderChildren(currentBookmarks(), parentId).findIndex((n) => n.id === node.id) + 1) : undefined;
  if (choice === "addPage") void editBookmark(null, windowId, { profileId, parentId: parentId ?? undefined, index });
  if (choice === "addFolder") {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId });
    if (title) addBookmarkFolder({ profileId, title, parentId: parentId ?? undefined, index });
  }
  if (choice === "manage") openInternalPage("bookmarks", windowId);
  if (choice.startsWith("bar:")) updateSettings({ bookmarksBar: choice.slice(4) as typeof barMode });
}
