import { prompt } from "../../platform/dialogs";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { menuSections } from "../app/menuSections";
import { deleteSpace } from "../browser/actions";
import { currentSpace, currentSpaceOrder, currentSettings } from "../browser/current";
import type { ProfileColor } from "../browser/types";
import { goToSettingsPane, openSettings } from "../settings/settingsWindows";
import { setDefaultSpace, setSwitcherIcon, updateSpace } from "./actions";
import { choosePresetColor } from "./themeActions";

export type SpaceMenuPlace = "sidebar" | "settings";
export type SpaceColorChoice = { id: ProfileColor; title: string; swatch: string };
export type IconChoice = { icon: string | null };
export type IconMenuItem = ChoiceItem<IconChoice, "emoji">;
type SpaceMenuItem = ChoiceItem<IconChoice | { color: ProfileColor }, "rename" | "icon" | "color" | "settings" | "details" | "default" | "delete" | "emoji">;

export type SpaceMenuState = {
  place: SpaceMenuPlace;
  hasIcon: boolean;
  iconItems: IconMenuItem[];
  colors: SpaceColorChoice[];
  color: ProfileColor | null;
  isDefault: boolean;
  only: boolean;
};

export function spaceMenuItems({ place, hasIcon, iconItems, colors, color, isDefault, only }: SpaceMenuState): SpaceMenuItem[] {
  return menuSections<SpaceMenuItem>(
    [
      { id: "rename" as const, title: "Rename…", symbol: "pencil" },
      { id: "icon" as const, title: hasIcon ? "Change Icon" : "Add Icon", symbol: "photo", children: iconItems },
      { id: "color" as const, title: "Color", symbol: "paintpalette", children: colors.map((c) => ({ value: { color: c.id }, title: c.title, swatch: c.swatch, checked: c.id === color })) },
    ],
    place === "sidebar"
      ? [{ id: "settings" as const, title: "Space Settings…", symbol: "gearshape" }]
      : [
          { id: "details" as const, title: "Show Space Details", symbol: "info.circle" },
          { id: "default" as const, title: "Make Default Space", symbol: "star", enabled: !isDefault },
        ],
    [{ id: "delete" as const, title: "Delete Space…", symbol: "trash" }],
  );
}

export async function renameSpace(spaceId: string, windowId?: string) {
  const profile = currentSpace(spaceId);
  if (!profile) return;
  const name = await prompt({ title: "Rename Space", value: profile.name, placeholder: "Space name", confirmTitle: "Rename", windowId });
  if (name?.trim() && currentSpace(spaceId)) updateSpace(spaceId, { name: name.trim() });
}

export async function showSpaceMenu(
  spaceId: string,
  { place, windowId, iconItems, colors }: { place: SpaceMenuPlace; windowId?: string; iconItems: (current: string | null) => IconMenuItem[]; colors: SpaceColorChoice[] },
) {
  const profile = currentSpace(spaceId);
  if (!profile) return;
  const choice = await chooseFromMenu(
    spaceMenuItems({
      place,
      hasIcon: !!profile.icon,
      iconItems: iconItems(profile.icon),
      colors,
      color: profile.theme ? null : profile.color,
      isDefault: currentSettings().defaultSpaceId === spaceId,
      only: currentSpaceOrder().length <= 1,
    }),
  );
  if (!choice) return;
  if (typeof choice === "object") {
    if ("color" in choice) return choosePresetColor(spaceId, choice.color);
    return place === "sidebar" ? setSwitcherIcon(spaceId, choice.icon) : updateSpace(spaceId, { icon: choice.icon });
  }
  if (choice === "rename") return void renameSpace(spaceId, windowId);
  if (choice === "settings") return openSettings("spaces", spaceId);
  if (choice === "details") return goToSettingsPane("spaces", spaceId);
  if (choice === "default") return setDefaultSpace(spaceId);
  if (choice === "delete") return void deleteSpace(spaceId, windowId);
}
