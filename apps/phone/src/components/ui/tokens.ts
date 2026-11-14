export const ink = { white: "#FFFFFF", black: "#000000", clear: "#00000000", knobShadow: "rgba(0,0,0,0.25)" } as const;

export const toggleLayout = { width: 51, height: 31, knob: 27, inset: 2 } as const;

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
  switchOn: "#34C759",
  trayShadow: "#000000",
  trayDim: "rgba(0,0,0,0.28)",
  pageSurface: "#FFFFFF",
  tileFill: "rgba(118,118,128,0.2)",
  tileEdge: "rgba(0,0,0,0.14)",
  cardEdge: "rgba(0,0,0,0.08)",
  headerText: "rgba(14,15,16,0.88)",
  secondaryLabel: "rgba(60,60,67,0.6)",
  deckControl: "rgba(255,255,255,0.62)",
  destructive: "#FF3B30",
  panel: "#FFFFFF",
  divider: "rgba(0,0,0,0.09)",
  menuScrim: "rgba(0,0,0,0.12)",
  placeholderTints: ["#E8E6FB", "#FBE7EE", "#E3F0FB", "#E6F5EA", "#FDF0DD", "#EFE6F8"] as readonly string[],
  groupFill: "#FFFFFF",
  separator: "rgba(60,60,67,0.29)",
  tertiaryFill: "rgba(118,118,128,0.12)",
  tertiaryLabel: "rgba(60,60,67,0.3)",
  toastFill: "rgba(255,255,255,0.92)",
  toastShadow: "rgba(0,0,0,0.18)",
  panelBorder: "rgba(0,0,0,0.1)",
  dialogScrim: "rgba(0,0,0,0.32)",
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
  switchOn: "#30D158",
  trayShadow: "#000000",
  trayDim: "rgba(0,0,0,0.28)",
  pageSurface: "#000000",
  tileFill: "rgba(255,255,255,0.2)",
  tileEdge: "rgba(255,255,255,0.28)",
  cardEdge: "rgba(255,255,255,0.12)",
  headerText: "rgba(255,255,255,0.92)",
  secondaryLabel: "rgba(235,235,245,0.6)",
  deckControl: "rgba(255,255,255,0.14)",
  destructive: "#FF453A",
  panel: "#2A2A2A",
  divider: "rgba(255,255,255,0.09)",
  menuScrim: "rgba(0,0,0,0.3)",
  placeholderTints: ["#262447", "#3F2532", "#1E3046", "#1F3527", "#3D3020", "#30243F"] as readonly string[],
  groupFill: "#1C1C1E",
  separator: "rgba(84,84,88,0.6)",
  tertiaryFill: "rgba(118,118,128,0.24)",
  tertiaryLabel: "rgba(235,235,245,0.3)",
  toastFill: "rgba(44,42,43,0.9)",
  toastShadow: "rgba(0,0,0,0.5)",
  panelBorder: "rgba(255,255,255,0.1)",
  dialogScrim: "rgba(0,0,0,0.48)",
};

export const colorRoles = { light: lightRoles, dark: darkRoles } as const;

export const menuLayout = {
  sheetRadius: 38,
  inset: 16,
  innerRadius: 22,
  capsuleHeight: 44,
  tileHeight: 68,
  rowHeight: 50,
  iconSlot: 26,
  zoomButton: { width: 40, height: 34 },
  zoomReset: 48,
  sheetTopGap: 24,
} as const;

export const toastLayout = { minHeight: 44, verticalPadding: 11, iconSize: 17, barClearance: 64, sideInset: 32, shadowRadius: 14, shadowY: 6 } as const;

export const pageInk = { findError: "#C93333" } as const;

export const readerInk = {
  light: { background: "#FFFFFF", ink: "#1C1C1E", secondary: "rgba(28,28,30,0.6)" },
  sepia: { background: "#F8F1E3", ink: "#4F321C", secondary: "rgba(79,50,28,0.6)" },
  dark: { background: "#121214", ink: "#E3E3E6", secondary: "rgba(227,227,230,0.6)" },
} as const;

export const readerLayout = { minLeadAspect: 0.75, maxWidth: 680, topBar: 52, lineHeight: 1.52, titleScale: 1.55, titleLine: 1.2, paragraphGap: 0.9, headerGap: 1.2 } as const;

export const dialogLayout = { width: 312, radius: 28, fieldHeight: 48, choiceHeight: 48 } as const;

export const settingsLayout = {
  groupRadius: 26,
  rowMinHeight: 52,
  rowInset: 16,
  labelGap: 16,
  tile: 29,
  heroTile: 64,
  syncTile: 44,
  topBar: 52,
  swatch: 26,
  swatchRing: 2,
  swatchGap: 3,
  primaryButton: 54,
  onboardingIcon: 104,
  stepShift: 60,
  titleWidth: 240,
} as const;

export const settingsTint = {
  neutral: "#86888D",
  sync: "#458AFF",
  ads: "#FF5A5F",
  trackers: "#FFC829",
  cookies: "#FF901A",
  search: "#007AFF",
  blue: "#458AFF",
  archive: "#B059EE",
  keyboard: "#FFC829",
  nightShade: "#5856D6",
  green: "#3EA82E",
  clearData: "#FF5A5F",
  export: "#0153FF",
  onboarding: "#FF901A",
  swipe: "#458AFF",
  appLinks: "#3EA82E",
  bottomBar: "#30B0C7",
} as const;

export const faviconInk = { letter: "#FFFFFF", lightPlate: "rgba(255,255,255,0.92)", darkPlate: "rgba(0,0,0,0.78)" } as const;

export const trayShadow = { opacity: 0.14, radius: 24, offsetY: -4, elevation: 12 } as const;

export const scanInk = {
  glass: "rgba(255,255,255,0.2)",
  frame: "rgba(255,255,255,0.9)",
  note: "rgba(255,255,255,0.18)",
  soft: "rgba(255,255,255,0.75)",
} as const;

export const scanLayout = { frame: 250, frameRadius: 24, frameStroke: 3, noteRadius: 12, cancelInset: 8 } as const;

export const voiceInk = {
  label: "#FFFFFF",
  soft: "rgba(255,255,255,0.8)",
  quiet: "rgba(255,255,255,0.7)",
  bar: "rgba(255,255,255,0.85)",
  glass: "rgba(255,255,255,0.18)",
  transcript: "rgba(0,0,0,0.18)",
} as const;

export const voiceLayout = {
  logo: 128,
  pill: 50,
  cancel: 44,
  icon: 17,
  bar: 4,
  barGap: 4,
  barMin: 6,
  barRange: 38,
  waveHeight: 48,
  transcriptRadius: 22,
  levelMotion: 120,
} as const;

export const failureLayout = { icon: 36, textWidth: 320, button: 40 } as const;

export const sheetInk = { scrim: "rgba(0,0,0,0.25)" } as const;

export const sheetLayout = { topGap: 10, radius: 32, backgroundRadius: 24 } as const;

export const syncInk = { banner: "#FF9500" } as const;

export const spacesLayout = {
  headerCircle: 32,
  bannerGap: 10,
  bannerPadding: 12,
  bannerRadius: 14,
  headerGap: 6,
  headerBottom: 4,
  tileGap: 6,
  stackGap: 10,
  tileFaceRadius: 11,
  dot: 9,
  buttonTop: 6,
  stepBadge: 26,
  stepTileRadius: 7,
  stepDividerInset: 56,
} as const;

export const tabsInk = {
  incognitoCard: "#1C1D22",
  incognitoCardRaised: "#2A2B31",
  incognitoBackdrop: ["#1A1A1E", "#0E0E10"] as const,
  incognitoSheet: "#151517",
  cardShadow: "rgba(0,0,0,0.18)",
  tileShadow: "rgba(0,0,0,0.2)",
  onDark: "rgba(255,255,255,0.85)",
  onDarkSoft: "rgba(255,255,255,0.55)",
  onDarkChip: "rgba(255,255,255,0.6)",
  pagerBlack: "#000000",
  pagerShadow: ["rgba(0,0,0,0)", "rgba(0,0,0,0.08)", "rgba(0,0,0,0.26)"] as const,
  barShadeOnDark: "rgba(255,255,255,0.06)",
  barShadeOnLight: "rgba(0,0,0,0.025)",
} as const;

export const tabsLayout = {
  cardRadius: 13,
  displayCornerRadius: 55,
  faviconSize: 16,
  headerSpacing: 6,
  headerGap: 8,
  headerHeight: 20,
  barCircle: 35,
  barPlus: { width: 78, height: 40 },
  barSideInset: 16,
  tabStackTile: { width: 20, height: 26 },
  tabStackRadius: 5,
  tabStackButton: 47,
  barTouchClearance: 28,
  chipHeight: 32,
  faviconRadius: 4,
  menuWidth: 250,
  cardMenuHeight: 190,
  emptyWidth: 300,
  archiveTop: 52,
  archiveButton: 44,
  archiveField: 40,
  archiveTile: 28,
} as const;

export const space = { none: 0, hair: 1, tight: 2, xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, huge: 32 } as const;

export const shadowRadius = { tile: 1.5, knob: 2, card: 16, lifted: 24 } as const;

export const radius = { row: 14, field: 16, card: 20, sheet: 40 } as const;

export const capsule = (height: number) => height / 2;

export const font = {
  hero: { fontSize: 40, lineHeight: 46 },
  largeTitle: { fontSize: 34, lineHeight: 41 },
  title2: { fontSize: 22, lineHeight: 28 },
  title3: { fontSize: 20, lineHeight: 25 },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subheadline: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;

export const browseLayout = {
  barCollapseTravel: 30,
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
