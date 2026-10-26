import { prompt } from "../../platform/dialogs";
import { showMenu } from "../../platform/menus";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { activeTabId, plural } from "../browser/model";
import { dissolveTileFolder, folderIn, folderLabel, folderMembers, leaveTileFolder, newTileFolder, renameTileFolder } from "../pins/tileFolders";
import { dismissHover } from "../sidebar/hover";
import { measureRow } from "../sidebar/sidebarUi";

type Open = { windowId: string; folderId: string; anchor: { x: number; y: number; width: number; height: number } };

export const useFolderPanel = create<{ open: Open | null }>()(() => ({ open: null }));

export const folderPanel = () => useFolderPanel.getState().open;

let pressedAway: { folderId: string; at: number | undefined } | null = null;

export function closeFolderPanel() {
  if (useFolderPanel.getState().open) useFolderPanel.setState({ open: null });
}

export const closeFolderPanelWhenWindowMoves = (windowId: string) =>
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows) return;
    const w = s.windows[windowId];
    if (!w || w.profileId !== prev.windows[windowId]?.profileId || activeTabId(s, windowId) !== activeTabId(prev, windowId)) closeFolderPanel();
  });

export function closeFolderPanelIn(windowId: string | undefined): boolean {
  if (!windowId || folderPanel()?.windowId !== windowId) return false;
  closeFolderPanel();
  return true;
}

export function closeFolderPanelOnPress(event: { nativeEvent: { timestamp?: number } }) {
  const open = folderPanel();
  if (!open) return;
  pressedAway = { folderId: open.folderId, at: event.nativeEvent.timestamp };
  closeFolderPanel();
}

export const closedByPress = (folderId: string, at: number | undefined) => at !== undefined && pressedAway?.folderId === folderId && pressedAway.at === at;

export async function toggleFolderPanel(windowId: string, folderId: string) {
  const open = folderPanel();
  if (open?.windowId === windowId && open.folderId === folderId) return closeFolderPanel();
  dismissHover();
  const anchor = await measureRow(windowId, folderId);
  if (anchor) useFolderPanel.setState({ open: { windowId, folderId, anchor } });
}

const store = () => useBrowser.getState();

export async function renameFolder(windowId: string, folderId: string, title = "Rename Folder") {
  const folder = folderIn(store(), windowId, folderId);
  if (!folder) return;
  const name = await prompt({ title, value: folder.name, placeholder: "Folder", confirmTitle: "Update", windowId });
  if (name !== null) useBrowser.setState((s) => renameTileFolder(s, windowId, folderId, name));
}

export function newFolderWithTab(windowId: string, tabId: string) {
  const { state, folderId } = newTileFolder(store(), [tabId]);
  if (!folderId) return;
  useBrowser.setState(state);
  void renameFolder(windowId, folderId, "Name Folder");
}

export function removeFromFolder(tabId: string) {
  useBrowser.setState((s) => leaveTileFolder(s, [tabId]));
}

export async function openTileFolderMenu(windowId: string, folderId: string) {
  dismissHover();
  const members = folderMembers(store(), windowId, folderId);
  if (!members.length) return;
  const choice = await showMenu([
    { id: "rename", title: "Rename Folder…", symbol: "character.cursor.ibeam" },
    { id: "remove", title: "Remove Folder", symbol: "folder.badge.minus" },
    { separator: true },
    { id: "unpin", title: `Unpin ${plural(members.length, "Tab")}`, symbol: "pin.slash" },
  ]);
  if (choice === "rename") void renameFolder(windowId, folderId);
  else if (choice === "remove") useBrowser.setState((s) => dissolveTileFolder(s, windowId, folderId));
  else if (choice === "unpin") store().pinTabs(folderMembers(store(), windowId, folderId), false);
  if (choice) closeFolderPanel();
}

export const folderTitle = (windowId: string, folderId: string) => folderLabel(folderIn(store(), windowId, folderId));
