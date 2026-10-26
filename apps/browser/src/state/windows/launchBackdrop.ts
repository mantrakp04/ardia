import type { BrowserState } from "../browser/store";
import { spaceLookSource, type ThemeBackdropProps } from "../../lib/profileLook";
import { profileColorsOf } from "../profiles/looks";

export type LaunchBackdrop = ThemeBackdropProps & {
  dark: boolean;
  vibrancy: boolean;
  colors: [string, string];
  tintColor: string;
  tintAlpha: number;
  tintLightness: number;
  grainOpacity: number;
};

export function launchBackdrop(s: Pick<BrowserState, "windows" | "profiles" | "ui" | "settings">, windowId: string | null | undefined): LaunchBackdrop | null {
  const w = windowId ? s.windows[windowId] : undefined;
  if (!w || w.incognito || w.kind === "small") return null;
  const dark = s.ui.appDark;
  const theme = profileColorsOf(s.profiles[w.profileId], dark, spaceLookSource(s.settings));
  if (!theme) return null;
  return { dark, vibrancy: true, colors: theme.windowTint, ...theme.backdrop, grainOpacity: theme.grain };
}
