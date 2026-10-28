import { storeAction } from "../browser/store";
import { currentSettings } from "../browser/current";
import { updateSettings } from "../settings/actions";

export const updateProfile = storeAction("updateProfile");
export const setDefaultProfile = storeAction("setDefaultProfile");
export const reorderProfiles = storeAction("reorderProfiles");
export const addProfile = storeAction("createProfile");

export function setSwitcherIcon(profileId: string, icon: string | null) {
  updateProfile(profileId, { icon });
  if (icon && !currentSettings().profileSwitcherIcons) updateSettings({ profileSwitcherIcons: true });
}
