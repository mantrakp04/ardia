import { storeAction, useBrowser } from "../browser/store";
import { downloadsClosedByThisPress } from "../downloads/panelPress";

export const toggleSidebar = storeAction("toggleSidebar");
export const restoreClosed = storeAction("restoreClosed");
export const openPanel = storeAction("openPanel");
export const closePanel = storeAction("closePanel");
export const setDownloadsOpen = storeAction("setDownloadsOpen");
export const setFind = storeAction("setFind");
export const returnRefusedMove = storeAction("returnRefusedMove");
export const removeDownload = storeAction("removeDownload");
export const clearDownloads = storeAction("clearDownloads");

export function toggleDownloadsOpen(windowId: string) {
  if (downloadsClosedByThisPress(windowId)) return;
  setDownloadsOpen(windowId, !useBrowser.getState().windowUi[windowId]?.downloadsOpen);
}
