import { engineProfile, resolveWindowId } from "./model";
import { useBrowser } from "./store";
import { isSilenced, muteState, type MuteState } from "../tabs/mute";
import { focusedWindowOf } from "../windows/ui";
import { bookmarkRoots } from "../bookmarks/bookmarks";

export const currentSettings = () => useBrowser.getState().settings;
export const currentTab = (tabId: string) => useBrowser.getState().tabs[tabId];
export const currentWindow = (windowId: string) => useBrowser.getState().windows[windowId];
export const currentSpace = (spaceId: string) => useBrowser.getState().spaces[spaceId];
export const currentGroup = (groupId: string) => useBrowser.getState().groups[groupId];
export const focusedWindowId = () => focusedWindowOf(useBrowser.getState());
export const currentBookmarks = () => useBrowser.getState().bookmarks;
export const currentBookmarkRoots = (spaceId: string) => bookmarkRoots(useBrowser.getState(), spaceId);
export const currentSpaces = () => useBrowser.getState().spaces;
export const currentSpaceOrder = () => useBrowser.getState().spaceOrder;
export const currentEngineProfile = (spaceId: string) => engineProfile(useBrowser.getState(), spaceId);
export const resolvedWindowId = (windowId?: string | null) => resolveWindowId(useBrowser.getState(), windowId);
export const workspaceSnapshot = () => useBrowser.getState();
export const downloadsOpenIn = (windowId: string) => !!useBrowser.getState().windowUi[windowId]?.downloadsOpen;
export const currentLive = (tabId: string) => useBrowser.getState().live[tabId];
export function currentMuteState(tabId: string): MuteState {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  return tab ? muteState(s, tab) : null;
}
export function isTabSilenced(tabId: string): boolean {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  return !!tab && isSilenced(s, tab);
}
