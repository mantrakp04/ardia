import { prompt } from "../../platform/dialogs";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { menuSections } from "../app/menuSections";
import { deleteProfile } from "../browser/actions";
import { currentProfile, currentProfileOrder, currentSettings } from "../browser/current";
import type { ProfileColor } from "../browser/types";
import { goToSettingsPane, openSettings } from "../settings/settingsWindows";
import { setDefaultProfile, setSwitcherIcon, updateProfile } from "./actions";
import { choosePresetColor } from "./themeActions";

export type ProfileMenuPlace = "sidebar" | "settings";
export type ProfileColorChoice = { id: ProfileColor; title: string; swatch: string };
export type IconChoice = { icon: string | null };
export type IconMenuItem = ChoiceItem<IconChoice, "emoji">;
type ProfileMenuItem = ChoiceItem<IconChoice | { color: ProfileColor }, "rename" | "icon" | "color" | "settings" | "details" | "default" | "delete" | "emoji">;

export type ProfileMenuState = {
  place: ProfileMenuPlace;
  hasIcon: boolean;
  iconItems: IconMenuItem[];
  colors: ProfileColorChoice[];
  color: ProfileColor | null;
  isDefault: boolean;
  only: boolean;
};

export function profileMenuItems({ place, hasIcon, iconItems, colors, color, isDefault, only }: ProfileMenuState): ProfileMenuItem[] {
  return menuSections<ProfileMenuItem>(
    [
      { id: "rename" as const, title: "Rename…", symbol: "pencil" },
      { id: "icon" as const, title: hasIcon ? "Change Icon" : "Add Icon", symbol: "photo", children: iconItems },
      { id: "color" as const, title: "Color", symbol: "paintpalette", children: colors.map((c) => ({ value: { color: c.id }, title: c.title, swatch: c.swatch, checked: c.id === color })) },
    ],
    place === "sidebar"
      ? [{ id: "settings" as const, title: "Profile Settings…", symbol: "gearshape" }]
      : [
          { id: "details" as const, title: "Show Profile Details", symbol: "info.circle" },
          { id: "default" as const, title: "Make Default Profile", symbol: "star", enabled: !isDefault },
        ],
    [{ id: "delete" as const, title: "Delete Profile…", symbol: "trash", enabled: !only }],
  );
}

export async function renameProfile(profileId: string, windowId?: string) {
  const profile = currentProfile(profileId);
  if (!profile) return;
  const name = await prompt({ title: "Rename Profile", value: profile.name, placeholder: "Profile name", confirmTitle: "Rename", windowId });
  if (name?.trim() && currentProfile(profileId)) updateProfile(profileId, { name: name.trim() });
}

export async function showProfileMenu(
  profileId: string,
  { place, windowId, iconItems, colors }: { place: ProfileMenuPlace; windowId?: string; iconItems: (current: string | null) => IconMenuItem[]; colors: ProfileColorChoice[] },
) {
  const profile = currentProfile(profileId);
  if (!profile) return;
  const choice = await chooseFromMenu(
    profileMenuItems({
      place,
      hasIcon: !!profile.icon,
      iconItems: iconItems(profile.icon),
      colors,
      color: profile.theme ? null : profile.color,
      isDefault: currentSettings().defaultProfileId === profileId,
      only: currentProfileOrder().length <= 1,
    }),
  );
  if (!choice) return;
  if (typeof choice === "object") {
    if ("color" in choice) return choosePresetColor(profileId, choice.color);
    return place === "sidebar" ? setSwitcherIcon(profileId, choice.icon) : updateProfile(profileId, { icon: choice.icon });
  }
  if (choice === "rename") return void renameProfile(profileId, windowId);
  if (choice === "settings") return openSettings("profiles", profileId);
  if (choice === "details") return goToSettingsPane("profiles", profileId);
  if (choice === "default") return setDefaultProfile(profileId);
  if (choice === "delete") return void deleteProfile(profileId, windowId);
}
