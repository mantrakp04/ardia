import { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { backdropStops, presetLook, showsTheme, windowTintStops, type PresetSpec, type ProfileLook } from "../../lib/profileLook";
import { colorRoles, PROFILE_COLORS, type ColorRoles, type ProfileColor } from "./tokens";

export type StartBackdrop = { colors: string[]; diagonal: boolean };

export type Theme = ColorRoles & { backdrop: [string, string]; surface: string; start: StartBackdrop };

export const rolesFor = (dark: boolean): ColorRoles => (dark ? colorRoles.dark : colorRoles.light);

export const PROFILE_PRESETS: PresetSpec[] = (Object.keys(PROFILE_COLORS) as ProfileColor[]).map((key) => ({
  key,
  swatch: PROFILE_COLORS[key].swatch,
  tint: PROFILE_COLORS[key].tint,
}));

export const DEFAULT_PROFILE_COLOR: ProfileColor = "plum";

const DEFAULT_LOOK = presetLook(PROFILE_PRESETS.find((preset) => preset.key === DEFAULT_PROFILE_COLOR)!);

export const ProfileLookContext = createContext<ProfileLook>(DEFAULT_LOOK);

export const useProfileLook = () => useContext(ProfileLookContext);

export function useTheme(): Theme {
  const look = useProfileLook();
  const dark = useColorScheme() === "dark";
  return useMemo(() => {
    const backdrop = windowTintStops(look, dark);
    const start = { colors: backdropStops(look, dark, true), diagonal: showsTheme(look, dark, true) };
    return { ...rolesFor(dark), backdrop, surface: backdrop[0], start };
  }, [look, dark]);
}
