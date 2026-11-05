import type { BrowserState } from "../browser/store";
import type { ThemeBackdropProps } from "@ardia/core";
import { spaceLookSource } from "../../lib/profileLook";
import { profileColorsOf } from "../profiles/looks";
import { isRegularWindow } from "./small";

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
  if (!isRegularWindow(w)) return null;
  const dark = s.ui.appDark;
  const theme = profileColorsOf(s.profiles[w.profileId], dark, spaceLookSource(s.settings));
  if (!theme) return null;
  return { dark, vibrancy: true, colors: theme.windowTint, ...theme.backdrop, grainOpacity: theme.grain };
}
