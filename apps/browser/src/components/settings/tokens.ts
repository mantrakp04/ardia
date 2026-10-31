const dark = {
  windowFill: "#1E1E1E",
  sidebarDivider: "rgba(0,0,0,0.6)",
  miniWindow: "#2A2A2C",
  miniBar: "rgba(255,255,255,0.22)",
  miniField: "rgba(255,255,255,0.14)",
  miniPage: "rgba(255,255,255,0.08)",
  warningFill: "rgba(255,159,10,0.12)",
};

export type SettingsColors = typeof dark;

const light: SettingsColors = {
  windowFill: "#F2F2F2",
  sidebarDivider: "rgba(0,0,0,0.1)",
  miniWindow: "#E9E9EB",
  miniBar: "rgba(0,0,0,0.16)",
  miniField: "rgba(0,0,0,0.08)",
  miniPage: "#FFFFFF",
  warningFill: "rgba(255,149,0,0.1)",
};

export const settingsColors = { dark, light } as const;

const modeDark = { window: "#2B2226", line: "rgba(255,255,255,0.2)", page: "#1A1618" };
const modeLight: typeof modeDark = { window: "#EDE6EA", line: "rgba(0,0,0,0.12)", page: "#FFFFFF" };

export const modePreview = { dark: modeDark, light: modeLight } as const;

const themePreviewDark = { line: "rgba(255,255,255,0.35)", card: "rgba(18,18,18,0.72)" };
const themePreviewLight: typeof themePreviewDark = { line: "rgba(0,0,0,0.18)", card: "rgba(255,255,255,0.82)" };

export const themePreview = { dark: themePreviewDark, light: themePreviewLight } as const;

const stylePreviewDark = { backdrop: "#4A3A3E", tile: "rgba(255,255,255,0.1)", tileStroke: "rgba(255,255,255,0.14)" };
const stylePreviewLight: typeof stylePreviewDark = { backdrop: "#E6CED2", tile: "rgba(0,0,0,0.05)", tileStroke: "rgba(0,0,0,0.2)" };

export const stylePreview = { dark: stylePreviewDark, light: stylePreviewLight } as const;

export const settingsInk = {
  onAccentSecondary: "rgba(255,255,255,0.8)",
  knobOutline: "rgba(0,0,0,0.25)",
  thumbBorder: "rgba(0,0,0,0.2)",
  customSwatch: "#8E8E93",
} as const;

export const settingsType = {
  extensionTitle: { fontSize: 17 },
  lead: { fontSize: 12.5 },
  code: { fontSize: 26 },
} as const;

export const settingsMotion = {
  searchFlashIn: 120,
  searchFlashHold: 900,
  searchFlashOut: 700,
  profileRowSettle: 160,
} as const;
