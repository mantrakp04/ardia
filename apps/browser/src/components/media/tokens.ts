import { useTheme } from "../ui/theme";
import { colorRoles, ink, type ShadowLevel } from "../ui/tokens";
import { parseColor } from "../../lib/color";

export const HOVER_CARD = {
  radius: 12,
  shadow: { color: ink.black, opacity: { dark: colorRoles.dark.panelShadowOpacity * 0.8, light: colorRoles.light.panelShadowOpacity * 0.8 }, radius: 16, offset: [0, 6] } satisfies ShadowLevel,
};

const rgbOf = (color: string) => parseColor(color).slice(0, 3) as [number, number, number];

const light = {
  background: colorRoles.light.panel,
  backgroundRgb: rgbOf(colorRoles.light.panel),
  label: "rgba(0,0,0,0.85)",
  secondary: "rgba(0,0,0,0.5)",
  track: "rgba(0,0,0,0.1)",
  fill: "rgba(0,0,0,0.35)",
  hoverFill: "rgba(0,0,0,0.6)",
  artPlaceholder: "rgba(0,0,0,0.06)",
  border: "rgba(0,0,0,0.1)",
  shareBarBorder: "rgba(0,0,0,0.08)",
  iconTile: "rgba(0,0,0,0.05)",
  pickerSelected: "rgba(0,0,0,0.08)",
  previewBorder: "rgba(0,0,0,0.12)",
  previewFill: "rgba(0,0,0,0.03)",
};

const dark: typeof light = {
  background: colorRoles.dark.panel,
  backgroundRgb: rgbOf(colorRoles.dark.panel),
  label: "rgba(255,255,255,0.85)",
  secondary: "rgba(255,255,255,0.55)",
  track: "rgba(255,255,255,0.2)",
  fill: "rgba(255,255,255,0.5)",
  hoverFill: "rgba(255,255,255,0.8)",
  artPlaceholder: "rgba(255,255,255,0.08)",
  border: "rgba(255,255,255,0.1)",
  shareBarBorder: "rgba(255,255,255,0.1)",
  iconTile: "rgba(255,255,255,0.08)",
  pickerSelected: "rgba(255,255,255,0.14)",
  previewBorder: "rgba(255,255,255,0.15)",
  previewFill: "rgba(255,255,255,0.05)",
};

export type MediaTokens = typeof light;

export function useMediaTokens(): MediaTokens {
  return useTheme().dark ? dark : light;
}

export const CAPTURE_DOT_RIM = "rgba(0,0,0,0.25)";
export const ART_HOVER_SCRIM = "rgba(0,0,0,0.5)";

export const fadeStepColor = ([r, g, b]: [number, number, number], alpha: number) => `rgba(${r},${g},${b},${alpha})`;

export const mediaMotion = { shareBarSlide: 180, marqueePause: 1500, marqueeSpeed: 30 } as const;

export const mediaType = {
  time: { fontSize: 10 },
  resolution: { fontSize: 10.5 },
  castMessage: { fontSize: 12.5 },
} as const;
