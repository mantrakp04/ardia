import { useTheme } from "../ui/theme";
import { ink, space } from "../ui/tokens";

const DARK = {
  popupBorder: "rgba(255,255,255,0.16)",
};

const LIGHT: typeof DARK = {
  popupBorder: "rgba(0,0,0,0.14)",
};

export type ExtensionColors = typeof DARK;

export function useExtensionColors(): ExtensionColors {
  return useTheme().dark ? DARK : LIGHT;
}

export const EXTENSION_PAGE_BACKGROUND = ink.white;

export const BADGE_FALLBACK_FILL = "#5F6368";

export const SIDE_PANEL_HEADER_PAD_RIGHT = space.xs;

export const EXTENSION_ICON = 36;

export const PERMISSIONS_MAX_HEIGHT = 180;

export const PIN_LIST_MAX_HEIGHT = 300;
