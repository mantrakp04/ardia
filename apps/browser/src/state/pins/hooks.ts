import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { folderIn, folderLabel, folderMembers, tileFolderOf } from "./tileFolders";

export const useTileFolderMembers = (windowId: string, folderId: string) => useBrowser(useShallow((s) => folderMembers(s, windowId, folderId)));

export const useTileFolderLabel = (windowId: string, folderId: string) => useBrowser((s) => folderLabel(folderIn(s, windowId, folderId)));

export const useShownFolderTab = (windowId: string, folderId: string) =>
  useBrowser((s) => {
    const id = activeTabId(s, windowId);
    return id && tileFolderOf(s.tabs[id])?.id === folderId ? id : null;
  });

export const useIsSelected = (windowId: string, tabId: string) => useBrowser((s) => (s.selection[windowId] ?? []).includes(tabId));

export const useSelectionInGroup = (windowId: string, groupId: string) =>
  useBrowser((s) => {
    const selection = s.selection[windowId];
    return !!selection?.length && !!s.groups[groupId]?.tabIds.some((id) => selection.includes(id));
  });
