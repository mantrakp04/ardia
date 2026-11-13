import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { backdropTint, opaqueTint, tintForHue } from "../../lib/windowTint";
import { colorRoles, PROFILE_COLORS, type ColorRoles, type ProfileColor } from "./tokens";

export type Theme = ColorRoles & { backdrop: [string, string]; surface: string };

export function profileBackdrop(color: ProfileColor, dark: boolean): [string, string] {
  const spec = PROFILE_COLORS[color];
  const neutral = color === "neutral";
  return opaqueTint(backdropTint(spec.tint ?? tintForHue(spec.swatch, neutral), neutral), dark);
}

export const rolesFor = (dark: boolean): ColorRoles => (dark ? colorRoles.dark : colorRoles.light);

export function useTheme(color: ProfileColor = "plum"): Theme {
  const dark = useColorScheme() === "dark";
  return useMemo(() => {
    const backdrop = profileBackdrop(color, dark);
    return { ...rolesFor(dark), backdrop, surface: backdrop[0] };
  }, [color, dark]);
}
