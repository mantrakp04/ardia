import type { AreaLightPalette } from "@ardia/shaders";
import type { ProfileColor } from "../../lib/profileLook";
import { parseColor } from "../../lib/color";

export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const ink = { white: "#FFFFFF", black: "#000000", clear: "#00000000", neutralGrey: "#808080A6" } as const;

const darkRoles = {
  dark: true,
  grain: 0.006,
  card: "rgba(18,18,18,0.5)",
  cardEdge: "rgba(0,0,0,0.35)",
  divider: "rgba(255,255,255,0.09)",

  textPrimary: "#FFFFFF",
  textTab: "#FFFFFFC7",
  textSecondary: "#FFFFFF80",
  textTertiary: "#FFFFFF59",
  icon: "#F7F5FFC6",
  iconDisabled: "#F7F5FF4D",
  mark: "#FFFFFF",

  tabHover: "rgba(255,255,255,0.16)",
  tabPressed: "rgba(255,255,255,0.31)",
  tabSelected: "rgba(18,18,18,0.5)",
  tabSelectedText: "#FFFFFF",
  tabSelectedBorder: ["rgba(255,255,255,0.15)", "rgba(255,255,255,0.15)"] as [string, string],
  tabSelectedShadow: "rgba(255,255,255,0.15)",
  tabSelectedShadowRadius: 15,
  pinnedResting: "rgba(255,255,255,0.1)",
  pinnedRestingStroke: "rgba(255,255,255,0.14)",
  pinnedSelectedFill: "rgba(255,255,255,0.25)",
  pinnedSelectedRim: "rgba(0,0,0,0.85)",
  pinnedSelectedOutline: "rgba(255,255,255,0.2)",

  toolbarHover: "rgba(255,255,255,0.1)",
  toolbarPressed: "rgba(255,255,255,0.18)",
  urlPill: "rgba(255,255,255,0.07)",

  panel: "#2A2A2A",
  panelBorder: "rgba(255,255,255,0.1)",
  panelShadowOpacity: 0.5,
  scrim: "rgba(0,0,0,0.35)",
  rowSelected: "rgba(255,255,255,0.22)",
  rowHover: "rgba(255,255,255,0.07)",
  commandBarSelected: "rgba(255,255,255,0.145)",
  commandBarHover: "rgba(120,125,134,0.32)",
  selection: "rgba(120,125,134,0.7)",
  placeholder: "#FFFFFF87",
  chipBorder: "rgba(255,255,255,0.15)",
  chipText: "#FFFFFF99",
  goButton: "#DCCBD8",
  goButtonHover: "#E6D8E2",
  goButtonPressed: "#C9B8C5",
  goButtonIdle: "rgba(255,255,255,0.08)",

  ntpBarSolid: "#2D2D2D",
  ntpBarBorder: "rgba(120,125,134,0.32)",
  accent: "#4A77D4",
  faviconTile: "rgba(247,245,255,0.2)",
  dropZoneFill: "rgba(255,255,255,0.06)",

  popoverFill: "rgba(38,38,38,0.94)",
  popoverTint: "rgba(38,38,38,0.72)",
  popoverBorder: "rgba(255,255,255,0.14)",
  popoverRowPressed: "rgba(255,255,255,0.12)",
  promptFill: "rgba(255,255,255,0.1)",
  promptFillHover: "rgba(255,255,255,0.14)",
  promptFillPressed: "rgba(255,255,255,0.18)",
  toggleOff: "rgba(255,255,255,0.16)",

  tooltipFill: "#262626",
  tooltipRing: "rgba(0,0,0,0.4)",
  tooltipText: "rgba(255,255,255,0.85)",
  onPrimary: "#000000",
  ringRadioFill: "rgba(255,255,255,0.1)",
  ringRadioBorder: "rgba(255,255,255,0.25)",
  ringRadioOn: "#FFFFFF",
  hudCloseFill: "#FFFFFF14",
  hudCloseHover: "#FFFFFF4D",
  hudCloseBorder: "#FFFFFF1F",
  hudCloseGlyph: "#FFFFFFE6",

  groupFill: "rgba(255,255,255,0.045)",
  groupBorder: "rgba(255,255,255,0.07)",
  control: "rgba(255,255,255,0.1)",
  controlHover: "rgba(255,255,255,0.14)",
  controlPressed: "rgba(255,255,255,0.2)",
  controlBorder: "rgba(255,255,255,0.08)",
  field: "rgba(0,0,0,0.25)",
  fieldBorder: "rgba(255,255,255,0.12)",
  switchOff: "rgba(255,255,255,0.14)",
  knobBorder: "rgba(0,0,0,0.12)",
  formAccent: "#0A84FF",
  formAccentPressed: "#0060D0",
  onAccent: "#FFFFFF",
  destructive: "#FF453A",
  warning: "#FF9F0A",
  success: "#30D158",
  searchFlash: "rgba(10,132,255,0.22)",
};

export type ColorRoles = typeof darkRoles;

const lightRoles: ColorRoles = {
  dark: false,
  grain: 0.05,
  card: "rgba(255,255,255,0.7)",
  cardEdge: "rgba(0,0,0,0.08)",
  divider: "rgba(0,0,0,0.09)",

  textPrimary: "#000000",
  textTab: "#000000AD",
  textSecondary: "#00000080",
  textTertiary: "#00000059",
  icon: "#000000C6",
  iconDisabled: "#0000004D",
  mark: "#000000",

  tabHover: "rgba(255,255,255,0.55)",
  tabPressed: "rgba(255,255,255,0.7)",
  tabSelected: "rgba(255,255,255,0.7)",
  tabSelectedText: "#000000",
  tabSelectedBorder: ["rgba(255,255,255,0.98)", "rgba(0,0,0,0.06)"],
  tabSelectedShadow: "rgba(0,0,0,0.12)",
  tabSelectedShadowRadius: 12.5,
  pinnedResting: "rgba(0,0,0,0.05)",
  pinnedRestingStroke: "rgba(0,0,0,0.2)",
  pinnedSelectedFill: "rgba(255,255,255,0.7)",
  pinnedSelectedRim: "rgba(0,0,0,0.12)",
  pinnedSelectedOutline: "rgba(255,255,255,0.98)",

  toolbarHover: "rgba(0,0,0,0.06)",
  toolbarPressed: "rgba(0,0,0,0.1)",
  urlPill: "rgba(0,0,0,0.05)",

  panel: "#FFFFFF",
  panelBorder: "rgba(0,0,0,0.1)",
  panelShadowOpacity: 0.18,
  scrim: "rgba(0,0,0,0.15)",
  rowSelected: "rgba(15,24,44,0.08)",
  rowHover: "rgba(0,0,0,0.07)",
  commandBarSelected: "rgba(15,24,44,0.08)",
  commandBarHover: "rgba(15,24,44,0.05)",
  selection: "rgba(120,125,134,0.4)",
  placeholder: "#00000066",
  chipBorder: "rgba(0,0,0,0.12)",
  chipText: "#00000099",
  goButton: "#0F182C",
  goButtonHover: "#1B2640",
  goButtonPressed: "#26314A",
  goButtonIdle: "rgba(0,0,0,0.06)",

  ntpBarSolid: "#FEFFFF",
  ntpBarBorder: "rgba(0,0,0,0.07)",
  accent: "#6395FC",
  faviconTile: "rgba(0,0,0,0.13)",
  dropZoneFill: "rgba(0,0,0,0.04)",

  popoverFill: "rgba(255,255,255,0.96)",
  popoverTint: "rgba(255,255,255,0.7)",
  popoverBorder: "rgba(0,0,0,0.12)",
  popoverRowPressed: "rgba(0,0,0,0.1)",
  promptFill: "rgba(0,0,0,0.06)",
  promptFillHover: "rgba(0,0,0,0.09)",
  promptFillPressed: "rgba(0,0,0,0.12)",
  toggleOff: "rgba(0,0,0,0.12)",

  tooltipFill: "#FFFFFF",
  tooltipRing: "rgba(0,0,0,0.12)",
  tooltipText: "rgba(0,0,0,0.85)",
  onPrimary: "#FFFFFF",
  ringRadioFill: "#FFFFFF",
  ringRadioBorder: "rgba(0,0,0,0.2)",
  ringRadioOn: "#000000",
  hudCloseFill: "#00000033",
  hudCloseHover: "#0000004D",
  hudCloseBorder: "#00000014",
  hudCloseGlyph: "#FFFFFFE6",

  groupFill: "rgba(0,0,0,0.028)",
  groupBorder: "rgba(0,0,0,0.07)",
  control: "#FFFFFF",
  controlHover: "#F7F7F7",
  controlPressed: "#EBEBEB",
  controlBorder: "rgba(0,0,0,0.14)",
  field: "#FFFFFF",
  fieldBorder: "rgba(0,0,0,0.14)",
  switchOff: "rgba(0,0,0,0.1)",
  knobBorder: "rgba(0,0,0,0.12)",
  formAccent: "#007AFF",
  formAccentPressed: "#0060D0",
  onAccent: "#FFFFFF",
  destructive: "#FF3B30",
  warning: "#FF9500",
  success: "#34C759",
  searchFlash: "rgba(0,122,255,0.16)",
};

export const colorRoles = { dark: darkRoles, light: lightRoles } as const;

export type ColorRole = { [K in keyof ColorRoles]: ColorRoles[K] extends string ? K : never }[keyof ColorRoles];

export const closeOnArt = { rest: "rgba(255,255,255,0.1)", hover: "rgba(255,255,255,0.2)", pressed: "rgba(255,255,255,0.3)", glyph: "#FFFFFF8C" } as const;

export type SiteToolbarRoles = {
  text: string;
  secondary: string;
  icon: string;
  iconDisabled: string;
  hover: string;
  pressed: string;
  pill: string;
  divider: string;
};

export const siteToolbarRoles: { onLight: SiteToolbarRoles; onDark: SiteToolbarRoles } = {
  onLight: {
    text: "#000000E6",
    secondary: "#00000080",
    icon: "#000000C6",
    iconDisabled: "#00000040",
    hover: "rgba(0,0,0,0.07)",
    pressed: "rgba(0,0,0,0.12)",
    pill: "rgba(0,0,0,0.06)",
    divider: "rgba(0,0,0,0.1)",
  },
  onDark: {
    text: "#FFFFFF",
    secondary: "#FFFFFF99",
    icon: "#FFFFFFD9",
    iconDisabled: "#FFFFFF4D",
    hover: "rgba(255,255,255,0.14)",
    pressed: "rgba(255,255,255,0.22)",
    pill: "rgba(255,255,255,0.1)",
    divider: "rgba(255,255,255,0.12)",
  },
};

export type ProfileColorSpec = {
  name: string;
  swatch: string;
  palette: AreaLightPalette | null;
  powerUp?: string;
  tint?: string;
  action?: string;
};

export const PROFILE_COLORS: Record<ProfileColor, ProfileColorSpec> = {
  plum: {
    name: "Plum",
    swatch: "#C07A98",
    powerUp: "#B5556B",
    tint: "#B25B6B",
    action: "#DD899B",
    palette: "pink",
  },
  blue: { name: "Blue", swatch: "#4691C3", palette: "blue" },
  purple: { name: "Purple", swatch: "#7873AF", palette: "purple" },
  pink: { name: "Pink", swatch: "#D37B8B", palette: "pink" },
  red: { name: "Red", swatch: "#C1575C", palette: "red" },
  orange: { name: "Orange", swatch: "#D87249", palette: "orange" },
  yellow: { name: "Yellow", swatch: "#E3AC38", palette: "yellow" },
  green: { name: "Green", swatch: "#3EB489", palette: "green" },
  neutral: { name: "Neutral", swatch: "#8E8E93", palette: null },
};

export const INCOGNITO_TINT = "#3A3A3C";

export const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  s: 6,
  sm: 7,
  m: 8,
  ml: 10,
  l: 12,
  lx: 14,
  xl: 16,
  xlx: 18,
  xxl: 20,
  xxxl: 24,
} as const;

export type Space = keyof typeof space;

export const radius = {
  none: 0,
  xs: 3,
  s: 4,
  field: 5,
  control: 5.5,
  m: 6,
  button: 7,
  l: 8,
  card: 10,
  panel: 12,
  sheet: 14,
} as const;

export type Radius = keyof typeof radius;

export const font = {
  caption: { fontSize: 11 },
  footnote: { fontSize: 11.5 },
  small: { fontSize: 12 },
  body: { fontSize: 13 },
  title: { fontSize: 14 },
  heading: { fontSize: 15 },
} as const;

export type TypeSize = keyof typeof font;

export const weight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export type Weight = keyof typeof weight;

export type ShadowLevel = { color: string; opacity: { dark: number; light: number }; radius: number; offset: [number, number] };

export const shadow = {
  tooltip: { color: "#000000", opacity: { dark: 0.15, light: 0.08 }, radius: 4, offset: [0, 1] },
  popover: { color: "#000000", opacity: { dark: 0.45, light: 0.16 }, radius: 18, offset: [0, 8] },
  dialog: { color: "#000000", opacity: { dark: darkRoles.panelShadowOpacity, light: lightRoles.panelShadowOpacity }, radius: 24, offset: [0, 10] },
} satisfies Record<string, ShadowLevel>;

export type Shadow = keyof typeof shadow;

export const hairline = { panel: 0.5, ring: 0.5 } as const;

export const swatch = { size: 20, inset: 2, ring: 2, gap: 7 } as const;

export const opacity = { disabled: 0.45 } as const;
