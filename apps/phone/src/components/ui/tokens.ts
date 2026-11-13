export const ink = { white: "#FFFFFF", black: "#000000", clear: "#00000000" } as const;

export type ProfileColor = "plum" | "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "neutral";

export type ProfileColorSpec = { name: string; swatch: string; tint?: string; action?: string };

export const PROFILE_COLORS: Record<ProfileColor, ProfileColorSpec> = {
  plum: { name: "Plum", swatch: "#C07A98", tint: "#B25B6B", action: "#DD899B" },
  blue: { name: "Blue", swatch: "#4691C3" },
  purple: { name: "Purple", swatch: "#7873AF" },
  pink: { name: "Pink", swatch: "#D37B8B" },
  red: { name: "Red", swatch: "#C1575C" },
  orange: { name: "Orange", swatch: "#D87249" },
  yellow: { name: "Yellow", swatch: "#E3AC38" },
  green: { name: "Green", swatch: "#3EB489" },
  neutral: { name: "Neutral", swatch: "#8E8E93" },
};

const lightRoles = {
  dark: false,
  label: "#000000",
  foregroundPrimary: "rgba(14,15,16,0.9)",
  foregroundSecondary: "rgba(0,0,0,0.5)",
  foregroundTertiary: "rgba(0,0,0,0.3)",
  fieldFill: "rgba(0,0,0,0.06)",
  fieldStroke: "rgba(0,0,0,0.06)",
  rowIcon: "rgba(0,0,0,0.42)",
  rowHighlight: "rgba(0,0,0,0.05)",
  plusFill: "rgba(118,118,128,0.16)",
  chevronFill: "rgba(118,118,128,0.12)",
  controlEdge: "rgba(0,0,0,0.06)",
  disabled: "rgba(0,0,0,0.2)",
  accent: "#6395FC",
  formAccent: "#007AFF",
  trayShadow: "rgba(0,0,0,0.18)",
  trayDim: "rgba(0,0,0,0.28)",
  pageSurface: "#FFFFFF",
};

export type ColorRoles = typeof lightRoles;

const darkRoles: ColorRoles = {
  dark: true,
  label: "#FFFFFF",
  foregroundPrimary: "rgba(255,255,255,0.8)",
  foregroundSecondary: "rgba(255,255,255,0.5)",
  foregroundTertiary: "rgba(255,255,255,0.3)",
  fieldFill: "rgba(255,255,255,0.12)",
  fieldStroke: "rgba(255,255,255,0.08)",
  rowIcon: "rgba(255,255,255,0.5)",
  rowHighlight: "rgba(255,255,255,0.08)",
  plusFill: "rgba(255,255,255,0.16)",
  chevronFill: "rgba(255,255,255,0.13)",
  controlEdge: "rgba(255,255,255,0.1)",
  disabled: "rgba(255,255,255,0.25)",
  accent: "#4A77D4",
  formAccent: "#0A84FF",
  trayShadow: "rgba(0,0,0,0.5)",
  trayDim: "rgba(0,0,0,0.28)",
  pageSurface: "#000000",
};

export const colorRoles = { light: lightRoles, dark: darkRoles } as const;

export const space = { none: 0, xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, huge: 32 } as const;

export const radius = { row: 14, field: 16, card: 20, sheet: 40 } as const;

export const capsule = (height: number) => height / 2;

export const font = {
  title3: { fontSize: 20, lineHeight: 25 },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subheadline: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;

export const browseLayout = {
  searchFieldHeight: 47.5,
  searchFieldInset: 15,
  fieldLeading: 18,
  fieldTrailing: 10,
  trayFieldTop: 15,
  suggestionPitch: 58.5,
  suggestionIconSlot: 22,
  rowLeading: 12,
  rowTrailing: 7,
  refineWidth: 44,
  logoWidth: 132,
  logoHeight: 108,
  plusCapsule: { width: 78, height: 40 },
  chevronCircle: 35,
  barCenterFromBottom: 44,
  barSideInset: 20,
  hitTarget: 44,
  barHeight: 75,
  pageOverlap: 26,
  barControlScale: 0.93,
  progressHeight: 2.5,
  hostPillHeight: 40,
  accessory: { width: 32, height: 40 },
  traySurfaceInset: 8,
} as const;

export const logoInk = {
  sun: ["#FFCB45", "#F5A812"],
  backHill: ["#8DAF63", "#5E7D3E"],
  frontHill: ["#17604B", "#063528"],
  outline: "#FFFFFF",
} as const;
