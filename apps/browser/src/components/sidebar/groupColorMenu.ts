import { ink } from "../ui/tokens";
import type { GroupColorMenu } from "../../state/sidebar/menus";
import { GROUP_COLORS, NEUTRAL_GROUP_SWATCH, nearestGroupColor, type GroupTint } from "./tokens";

const COLORS: GroupTint[] = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

export const groupColorMenu: GroupColorMenu = (current, siteColor) => {
  const matched = siteColor ? nearestGroupColor(siteColor) : null;
  return [
    { id: "color:none", title: "None", swatch: ink.clear, checked: current === "none" },
    { id: "color:", title: "Neutral", swatch: NEUTRAL_GROUP_SWATCH.light, swatchDark: NEUTRAL_GROUP_SWATCH.dark, checked: !current },
    { id: `color:${matched ?? ""}`, title: "Match Site Color", enabled: !!matched, swatch: matched ? GROUP_COLORS[matched].hex : undefined },
    { separator: true },
    ...COLORS.map((c) => ({ id: `color:${c}`, title: GROUP_COLORS[c].name, swatch: GROUP_COLORS[c].hex, checked: current === c })),
  ];
};
