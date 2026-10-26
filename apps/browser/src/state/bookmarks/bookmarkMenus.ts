import { cleanUrl } from "@ardia/core";
import { copyText } from "../../platform/clipboard";
import { showMenu, type MenuItem } from "../../platform/menus";
import { addFolderToSidebar, makesGroup, restorableArcHolder, restoreArcFolders } from "./bookmarkGroups";
import { folderLinks } from "./bookmarks";
import { openFolder, openUrl } from "./actions";
import { editBookmark } from "./edit";
import { currentBookmarks } from "../browser/current";
import type { BookmarkNode } from "../browser/types";
import { openImport } from "../settings/settingsWindows";

export async function openOrganizeMenu(windowId: string, profileId: string, folderId: string | null) {
  const choice = await showMenu([
    { id: "bookmark", title: "Add New Bookmark…" },
    { id: "folder", title: "Add New Folder…" },
    { separator: true },
    { id: "import", title: "Import Bookmarks…" },
  ]);
  const parentId = folderId ?? undefined;
  if (choice === "bookmark") editBookmark(null, windowId, { profileId, parentId });
  if (choice === "folder") editBookmark(null, windowId, { profileId, parentId, folder: true });
  if (choice === "import") openImport();
}

export async function openBookmarkRowMenu(
  node: BookmarkNode,
  { windowId, profileId, showPath, onOpenFolder, onDelete }: { windowId: string; profileId: string; showPath: boolean; onOpenFolder: (folder?: string) => void; onDelete: () => void },
) {
  const open = (mode: Parameters<typeof openUrl>[2]) => node.kind === "url" && openUrl(node.url, windowId, mode);
  const items: MenuItem[] =
    node.kind === "url"
      ? [
          { id: "tab", title: "Open in New Tab" },
          { id: "window", title: "Open in New Window" },
          { id: "incognito", title: "Open in Incognito Window" },
          { id: "split", title: "Open in Split View" },
          { separator: true },
          { id: "edit", title: "Edit…" },
          { id: "copy", title: "Copy Link" },
        ]
      : [
          { id: "openAll", title: `Open All (${folderLinks(currentBookmarks(), node.id).length})` },
          { id: "openAllWindow", title: "Open All in New Window" },
          { id: "addGroup", title: "Add to Sidebar as Group", enabled: makesGroup({ bookmarks: currentBookmarks() }, node.id) },
          ...(restorableArcHolder({ bookmarks: currentBookmarks() }, node.id) ? [{ id: "restoreArc", title: "Restore Arc Folders as Groups" }] : []),
          { separator: true },
          { id: "edit", title: "Rename…" },
        ];
  if (showPath) items.push({ id: "show", title: "Show in Folder" });
  items.push({ separator: true }, { id: "delete", title: "Delete" });
  const choice = await showMenu(items);
  if (choice === "tab") open("foreground");
  if (choice === "window") open("window");
  if (choice === "incognito") open("incognito");
  if (choice === "split") open("split");
  if (choice === "copy" && node.kind === "url") copyText(cleanUrl(node.url));
  if (choice === "edit") editBookmark(node.id, windowId, { profileId });
  if (choice === "openAll") void openFolder(node.id, windowId);
  if (choice === "openAllWindow") void openFolder(node.id, windowId, "window");
  if (choice === "addGroup") addFolderToSidebar(node.id, windowId);
  if (choice === "restoreArc") restoreArcFolders(node.id, windowId);
  if (choice === "show" && node.parentId) onOpenFolder(node.parentId);
  if (choice === "delete") onDelete();
}
