import { call } from "./engine/call";

export const setProfileBoosts = (profile: string, json: string) => call("boosts.setProfileBoosts", { profile, json });
export const previewBoost = (tabId: string, json: string) => call("boosts.previewBoost", { tabId, json });
export const clearBoostPreview = (tabId: string) => call("boosts.clearBoostPreview", { tabId });
