import { PROFILE_COLORS } from "../ui";
import type { ProfileColor } from "../../state/browser/types";
import { showProfileMenu, type ProfileMenuPlace } from "../../state/profiles/profileMenu";
import { iconMenuItems } from "./ProfileIcons";

const COLORS = (Object.keys(PROFILE_COLORS) as ProfileColor[]).map((id) => ({ id, title: PROFILE_COLORS[id].name, swatch: PROFILE_COLORS[id].swatch }));

export function openProfileItemMenu(profileId: string, place: ProfileMenuPlace, windowId?: string) {
  return showProfileMenu(profileId, {
    place,
    windowId,
    iconItems: (current) => iconMenuItems(current, place === "sidebar" ? "None" : "Initial"),
    colors: COLORS,
  });
}
