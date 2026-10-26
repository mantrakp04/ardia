import { storeAction } from "../browser/store";

export const placeTabs = storeAction("placeTabs");
export const dropTabs = storeAction("dropTabs");
export const pinTabs = storeAction("pinTabs");
export const cleanUpTabs = storeAction("cleanUpTabs");
export const returnToPinnedUrl = storeAction("returnToPinnedUrl");
export const restoreCleaned = storeAction("restoreCleaned");
export const setSelection = storeAction("setSelection");
export const setPinnedUrl = storeAction("setPinnedUrl");
export const newTabInGroup = storeAction("newTabInGroup");
export const moveGroup = storeAction("moveGroup");
export const duplicateGroup = storeAction("duplicateGroup");
export const moveGroupToBookmarksBar = storeAction("moveGroupToBookmarksBar");
export const closeAbandonedNewTabs = storeAction("closeAbandonedNewTabs");
