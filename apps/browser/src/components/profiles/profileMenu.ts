import type { View } from "react-native";
import { PROFILE_COLORS } from "../ui";
import type { ProfileColor } from "../../state/browser/types";
import { showProfileMenu, type ProfileMenuPlace } from "../../state/profiles/profileMenu";

const COLORS = (Object.keys(PROFILE_COLORS) as ProfileColor[]).map((id) => ({ id, title: PROFILE_COLORS[id].name, swatch: PROFILE_COLORS[id].swatch }));

export function openProfileItemMenu(profileId: string, place: ProfileMenuPlace, windowId: string, anchor: View | null) {
  return showProfileMenu(profileId, { place, windowId, anchor, colors: COLORS });
}
