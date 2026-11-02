import type { View } from "react-native";
import { prompt } from "../../platform/dialogs";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { menuSections } from "../app/menuSections";
import { deleteProfile } from "../browser/actions";
import { currentProfile, currentProfileOrder, currentSettings } from "../browser/current";
import type { ProfileColor } from "../browser/types";
import { goToSettingsPane, openSettings } from "../settings/settingsWindows";
import { commitProfileName, setDefaultProfile } from "./actions";
import { openProfileIconPicker } from "./iconPicker";
import { choosePresetColor } from "./themeActions";

export type ProfileMenuPlace = "sidebar" | "settings";
export type ProfileColorChoice = { id: ProfileColor; title: string; swatch: string };
type ProfileMenuItem = ChoiceItem<{ color: ProfileColor }, "rename" | "icon" | "color" | "settings" | "details" | "default" | "delete">;

export type ProfileMenuState = {
  place: ProfileMenuPlace;
  hasIcon: boolean;
  colors: ProfileColorChoice[];
  color: ProfileColor | null;
  isDefault: boolean;
  only: boolean;
};

export function profileMenuItems({ place, hasIcon, colors, color, isDefault, only }: ProfileMenuState): ProfileMenuItem[] {
  return menuSections<ProfileMenuItem>(
    [
      { id: "rename" as const, title: "Rename…", symbol: "pencil" },
      { id: "icon" as const, title: hasIcon ? "Change Icon…" : "Add Icon…", symbol: "photo" },
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
  if (name !== null) commitProfileName(profileId, name);
}

export async function showProfileMenu(
  profileId: string,
  { place, windowId, anchor, colors }: { place: ProfileMenuPlace; windowId: string; anchor: View | null; colors: ProfileColorChoice[] },
) {
  const profile = currentProfile(profileId);
  if (!profile) return;
  const choice = await chooseFromMenu(
    profileMenuItems({
      place,
      hasIcon: !!profile.icon,
      colors,
      color: profile.theme ? null : profile.color,
      isDefault: currentSettings().defaultProfileId === profileId,
      only: currentProfileOrder().length <= 1,
    }),
  );
  if (!choice) return;
  if (typeof choice === "object") return choosePresetColor(profileId, choice.color);
  if (choice === "icon") return void openProfileIconPicker(profileId, windowId, place, anchor);
  if (choice === "rename") return void renameProfile(profileId, windowId);
  if (choice === "settings") return openSettings("profiles", profileId);
  if (choice === "details") return goToSettingsPane("profiles", profileId);
  if (choice === "default") return setDefaultProfile(profileId);
  if (choice === "delete") return void deleteProfile(profileId, windowId);
}
