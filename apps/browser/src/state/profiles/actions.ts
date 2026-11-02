import { storeAction } from "../browser/store";
import { currentProfile, currentSettings } from "../browser/current";
import { updateSettings } from "../settings/actions";

export const updateProfile = storeAction("updateProfile");
export const setDefaultProfile = storeAction("setDefaultProfile");
export const reorderProfiles = storeAction("reorderProfiles");
export const createProfile = storeAction("createProfile");

export function setSwitcherIcon(profileId: string, icon: string | null) {
  updateProfile(profileId, { icon });
  if (icon && !currentSettings().profileSwitcherIcons) updateSettings({ profileSwitcherIcons: true });
}

export function commitProfileName(profileId: string, text: string): boolean {
  const name = text.trim();
  const profile = currentProfile(profileId);
  if (!profile || !name) return false;
  if (name !== profile.name) updateProfile(profileId, { name });
  return true;
}
