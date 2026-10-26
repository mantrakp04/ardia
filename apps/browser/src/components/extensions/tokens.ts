import { useTheme } from "../ui/theme";
import { ink, type ShadowLevel } from "../ui/tokens";

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

export const POPUP_SHADOW: ShadowLevel = { color: ink.black, opacity: { dark: 0.45, light: 0.18 }, radius: 16, offset: [0, 6] };

export const EXTENSION_PAGE_BACKGROUND = ink.white;

export const BADGE_FALLBACK_FILL = "#5F6368";

export const BADGE_TEXT = { fontSize: 8.5, lineHeight: 11 } as const;

export const DIALOG_TITLE = { fontSize: 15 } as const;

export const DIALOG_WIDTH = 380;

export const DIALOG_APPEAR_MS = 170;

export const SIDE_PANEL_HEADER_PAD_RIGHT = 5;
