import { storeAction, useBrowser } from "../browser/store";
import { newTabToasts, type NewTabToast } from "./newTabToasts";

export const newTab = storeAction("newTab");
export const activate = storeAction("activate");
export const navigate = storeAction("navigate");
export const updateTab = storeAction("updateTab");
export const updateLive = storeAction("updateLive");
export const closeTabs = storeAction("closeTabs");
export const duplicateTab = storeAction("duplicateTab");
export const togglePin = storeAction("togglePin");
export const closeTabNow = storeAction("closeTab");

export const presentNewTabToast = (tabId: string) => newTabToasts.present(tabId);

export const activateNewTabToast = (toast: NewTabToast) => newTabToasts.activate(toast.tabId, toast.windowId, toast.profileId, useBrowser.getState());
