import { storeAction } from "../browser/store";
import { currentSettings } from "../browser/current";
import { updateSettings } from "../settings/actions";

export const updateSpace = storeAction("updateSpace");
export const setDefaultSpace = storeAction("setDefaultSpace");
export const reorderSpaces = storeAction("reorderSpaces");
export const assignSpaceProfile = storeAction("assignSpaceProfile");
export const addSpace = storeAction("createSpace");

export function setSwitcherIcon(spaceId: string, icon: string | null) {
  updateSpace(spaceId, { icon });
  if (icon && !currentSettings().spaceSwitcherIcons) updateSettings({ spaceSwitcherIcons: true });
}
