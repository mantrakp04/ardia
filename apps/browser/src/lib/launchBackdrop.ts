import type { BrowserState } from "../store/browser";
import type { ThemeBackdropProps } from "./profileTheme";
import { profileTheme } from "./theme";

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
  const theme = profileTheme(s.profiles[w.profileId], dark, s.settings.followSystemAppearance);
  return { dark, vibrancy: true, colors: theme.windowTint, ...theme.backdrop, grainOpacity: theme.grain };
}
