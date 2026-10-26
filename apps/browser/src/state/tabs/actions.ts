import { storeAction } from "../browser/store";

export const newTab = storeAction("newTab");
export const activate = storeAction("activate");
export const navigate = storeAction("navigate");
export const updateTab = storeAction("updateTab");
export const updateLive = storeAction("updateLive");
export const closeTabs = storeAction("closeTabs");
export const duplicateTab = storeAction("duplicateTab");
export const togglePin = storeAction("togglePin");
export const closeTabNow = storeAction("closeTab");
export const navigated = storeAction("navigated");
export const faviconChanged = storeAction("faviconChanged");
