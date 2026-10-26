import { resolveWindowId } from "./model";
import { useBrowser } from "./store";

export const currentSettings = () => useBrowser.getState().settings;
export const currentTab = (tabId: string) => useBrowser.getState().tabs[tabId];
export const currentWindow = (windowId: string) => useBrowser.getState().windows[windowId];
export const currentProfile = (profileId: string) => useBrowser.getState().profiles[profileId];
export const currentGroup = (groupId: string) => useBrowser.getState().groups[groupId];
export const focusedWindowId = () => useBrowser.getState().ui.focusedWindowId;
export const currentBookmarks = () => useBrowser.getState().bookmarks;
export const currentProfiles = () => useBrowser.getState().profiles;
export const currentProfileOrder = () => useBrowser.getState().profileOrder;
export const resolvedWindowId = (windowId?: string | null) => resolveWindowId(useBrowser.getState(), windowId);
export const workspaceSnapshot = () => useBrowser.getState();
export const downloadsOpenIn = (windowId: string) => !!useBrowser.getState().windowUi[windowId]?.downloadsOpen;
export const currentLive = (tabId: string) => useBrowser.getState().live[tabId];
