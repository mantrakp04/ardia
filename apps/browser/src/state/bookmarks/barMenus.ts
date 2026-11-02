import { prompt } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import { addFolderToSidebar, makesGroup, restorableArcHolder, restoreArcFolders } from "./bookmarkGroups";
import { bookmarkRoots, folderChildren, folderLinks } from "./bookmarks";
import { addBookmarkFolder, FOLDER_MANY, removeBookmark } from "./actions";
import { copyLinkItems, openAllItems, openLinkItems, runLinkChoice } from "./linkMenus";
import { menuSections, type MenuKey } from "../app/menuSections";
import { menuShortcut } from "../commands/commandShortcuts";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { editBookmark } from "./edit";
import { currentBookmarks } from "../browser/current";
import type { BookmarkNode } from "../browser/types";
import { openInternalPage } from "../pages/urls";
import { updateSettings } from "../settings/actions";
import type { Settings } from "../settings/settings";

export type ClickMods = { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

export async function openImportButtonMenu() {
  const choice = await showMenu([{ id: "hide", title: "Hide Import Bookmarks Button" }]);
  if (choice === "hide") updateSettings({ hideBookmarksBarImport: true });
}

export type BarMenuTarget = { kind: "url" } | { kind: "folder"; links: number; makesGroup: boolean; restoresArc: boolean } | null;

type BarSizeChoice = Settings["bookmarksBarSize"];

const BAR_SIZES: { id: BarSizeChoice; title: string }[] = [
  { id: "default", title: "Default" },
  { id: "large", title: "Large" },
];

export function barMenuItems(
  target: BarMenuTarget,
  { barShown, size = "default", keys = menuShortcut }: { barShown: boolean; size?: BarSizeChoice; keys?: (command: string) => MenuKey },
): MenuItem[] {
  if (target?.kind === "url") return menuSections(openLinkItems(), copyLinkItems(), [{ id: "edit", title: "Edit…", symbol: "pencil" }], [{ id: "delete", title: "Delete", symbol: "trash" }]);
  if (target?.kind === "folder")
    return menuSections(
      openAllItems(target.links),
      [
        { id: "addGroup", title: "Add to Sidebar as Group", symbol: "sidebar.left", enabled: target.makesGroup },
        target.restoresArc && { id: "restoreArc", title: "Restore Arc Folders as Groups" },
      ],
      [
        { id: "rename", title: "Rename…", symbol: "pencil" },
        { id: "addFolder", title: "New Folder…", symbol: "folder.badge.plus" },
      ],
      [{ id: "delete", title: "Delete Folder", symbol: "trash" }],
    );
  return menuSections(
    [
      { id: "addPage", title: "Add Page…", symbol: "bookmark" },
      { id: "addFolder", title: "New Folder…", symbol: "folder.badge.plus" },
    ],
    [
      { id: "manage", title: "Manage Bookmarks", symbol: "book", ...keys("manageBookmarks") },
      { id: "toggleBar", title: "Show Bookmarks Bar", checked: barShown, ...keys("toggleBookmarksBar") },
      { id: "size", title: "Bookmarks Bar Size", children: BAR_SIZES.map((s) => ({ id: `size:${s.id}`, title: s.title, checked: s.id === size })) },
    ],
  );
}

function barShownIn(windowId: string) {
  const s = useBrowser.getState();
  const mode = s.settings.bookmarksBar;
  const active = activeTabId(s, windowId);
  return mode === "always" || (mode === "newTab" && !(active && s.tabs[active]?.url));
}

export async function openBarMenu(windowId: string, profileId: string, node: BookmarkNode | null) {
  const s = useBrowser.getState();
  const barShown = barShownIn(windowId);
  const target: BarMenuTarget =
    node?.kind === "url"
      ? { kind: "url" }
      : node?.kind === "folder"
        ? { kind: "folder", links: folderLinks(s.bookmarks, node.id).length, makesGroup: makesGroup(s, node.id), restoresArc: restorableArcHolder(s, node.id) }
        : null;
  const choice = await showMenu(barMenuItems(target, { barShown, size: useBrowser.getState().settings.bookmarksBarSize }));
  if (!choice) return;
  const bar = bookmarkRoots(s, profileId)?.bar;
  if (node?.kind === "url") {
    if (runLinkChoice(choice, [node], windowId)) return;
    if (choice === "edit") void editBookmark(node.id, windowId);
  }
  if (node?.kind === "folder") {
    if (runLinkChoice(choice, folderLinks(currentBookmarks(), node.id), windowId, FOLDER_MANY)) return;
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
  if (choice === "toggleBar") updateSettings({ bookmarksBar: barShownIn(windowId) ? "never" : "always" });
  const size = BAR_SIZES.find((s) => choice === `size:${s.id}`);
  if (size) updateSettings({ bookmarksBarSize: size.id });
}
