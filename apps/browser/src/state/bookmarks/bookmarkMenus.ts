import { showMenu, type MenuItem } from "../../platform/menus";
import { menuSections } from "../app/menuSections";
import { addFolderToSidebar, makesGroup, restorableArcHolder, restoreArcFolders } from "./bookmarkGroups";
import { folderChildren, folderLinks, type BookmarkOwners } from "./bookmarks";
import { editBookmark } from "./edit";
import { copyLinkItems, openAllItems, openLinkItems, runLinkChoice, type Link } from "./linkMenus";
import { FOLDER_MANY } from "./actions";
import { currentBookmarks } from "../browser/current";
import { useBrowser } from "../browser/store";
import type { BookmarkNode, Bookmarks } from "../browser/types";
import { openImport } from "../settings/settingsWindows";
import { exportBookmarksFromWindow } from "./exportHtml";

export async function openOrganizeMenu(windowId: string, profileId: string, folderId: string | null) {
  const choice = await showMenu([
    { id: "bookmark", title: "Add Page…", symbol: "bookmark" },
    { id: "folder", title: "New Folder…", symbol: "folder.badge.plus" },
    { separator: true },
    { id: "import", title: "Import Bookmarks…", symbol: "square.and.arrow.down" },
    { id: "export", title: "Export Bookmarks…", symbol: "square.and.arrow.up" },
  ]);
  const parentId = folderId ?? undefined;
  if (choice === "bookmark") editBookmark(null, windowId, { profileId, parentId });
  if (choice === "folder") editBookmark(null, windowId, { profileId, parentId, folder: true });
  if (choice === "import") openImport();
  if (choice === "export") void exportBookmarksFromWindow(windowId);
}

export type RowMenuTarget =
  | { kind: "url"; showPath: boolean }
  | { kind: "folder"; links: number; makesGroup: boolean; restoresArc: boolean; showPath: boolean }
  | { kind: "several"; links: number; items: number; noun: string };

const showInFolder = (showPath: boolean) => showPath && { id: "show", title: "Show in Folder", symbol: "folder" };

export function bookmarkRowMenuItems(target: RowMenuTarget): MenuItem[] {
  if (target.kind === "url")
    return menuSections([...openLinkItems(), showInFolder(target.showPath)], copyLinkItems(), [{ id: "edit", title: "Edit…", symbol: "pencil" }], [{ id: "delete", title: "Delete", symbol: "trash" }]);
  if (target.kind === "folder")
    return menuSections(
      [...openAllItems(target.links), showInFolder(target.showPath)],
      [
        { id: "addGroup", title: "Add to Sidebar as Group", symbol: "sidebar.left", enabled: target.makesGroup },
        target.restoresArc && { id: "restoreArc", title: "Restore Arc Folders as Groups" },
      ],
      [
        { id: "edit", title: "Rename…", symbol: "pencil" },
        { id: "newFolder", title: "New Folder…", symbol: "folder.badge.plus" },
      ],
      [{ id: "delete", title: "Delete Folder", symbol: "trash" }],
    );
  return menuSections(openAllItems(target.links, target.links), copyLinkItems(target.links), [
    { id: "delete", title: `Delete ${target.items} ${target.noun}`, symbol: "trash" },
  ]);
}

function linksOf(b: Bookmarks, nodes: BookmarkNode[]): Link[] {
  return nodes.flatMap((n) => (n.kind === "url" ? [n] : folderLinks(b, n.id)));
}

const nounFor = (nodes: BookmarkNode[]) =>
  nodes.every((n) => n.kind === "url") ? "Bookmarks" : nodes.every((n) => n.kind === "folder") ? "Folders" : "Items";

export function rowMenuTarget(s: BookmarkOwners, nodes: BookmarkNode[], showPath: boolean): RowMenuTarget | null {
  const [node] = nodes;
  if (!node) return null;
  if (nodes.length > 1) return { kind: "several", links: linksOf(s.bookmarks, nodes).length, items: nodes.length, noun: nounFor(nodes) };
  if (node.kind === "url") return { kind: "url", showPath };
  return { kind: "folder", links: folderLinks(s.bookmarks, node.id).length, makesGroup: makesGroup(s, node.id), restoresArc: restorableArcHolder(s, node.id), showPath };
}

export async function openBookmarkRowMenu(
  node: BookmarkNode,
  {
    windowId,
    profileId,
    showPath,
    selection,
    onOpenFolder,
    onDelete,
  }: { windowId: string; profileId: string; showPath: boolean; selection: string[]; onOpenFolder: (folder?: string) => void; onDelete: () => void },
) {
  const s = useBrowser.getState();
  const nodes = selection.includes(node.id) && selection.length > 1 ? selection.map((id) => s.bookmarks.nodes[id]).filter((n): n is BookmarkNode => !!n) : [node];
  const target = rowMenuTarget(s, nodes, showPath);
  if (!target) return;
  const choice = await showMenu(bookmarkRowMenuItems(target));
  if (!choice) return;
  if (runLinkChoice(choice, linksOf(currentBookmarks(), nodes), windowId, target.kind === "folder" ? FOLDER_MANY : undefined)) return;
  if (choice === "edit") editBookmark(node.id, windowId, { profileId });
  if (choice === "newFolder") {
    const parentId = node.parentId ?? undefined;
    const index = parentId ? folderChildren(currentBookmarks(), parentId).findIndex((n) => n.id === node.id) + 1 : undefined;
    editBookmark(null, windowId, { profileId, parentId, index, folder: true });
  }
  if (choice === "addGroup") addFolderToSidebar(node.id, windowId);
  if (choice === "restoreArc") restoreArcFolders(node.id, windowId);
  if (choice === "show" && node.parentId) onOpenFolder(node.parentId);
  if (choice === "delete") onDelete();
}
