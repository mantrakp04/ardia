import * as ardiacore from "@ardia/ardiacore";

export const setProfileBoosts = (engineProfileId: string, json: string) => ardiacore.setProfileBoosts(engineProfileId, json);
export const previewBoost = (tabId: string, json: string) => ardiacore.previewBoost(tabId, json);
export const clearBoostPreview = (tabId: string) => ardiacore.clearBoostPreview(tabId);
