import type { AreaLightPalette } from "@ardia/shaders";
import { createContext, createElement, useContext, type ReactNode } from "react";
import { useBrowser, type BrowserState } from "../store/browser";
import { PageProfileContext, WindowContext } from "../store/hooks";
import type { Profile, ProfileColor, ProfileTheme } from "../store/types";
import { opaqueThemeTint, PRESET_BACKDROP, readableDark, resolveTheme, rgbToHsl, themeAccent, themeBackdrop, themeDark, themePalette, type ThemeBackdropProps } from "./profileTheme";
import { backdropTint, opaqueTint, tintForHue, type BackdropTint } from "./windowTint";

export type Theme = typeof dark & {
  profileColor: ProfileColor | "incognito";
  backdrop: BackdropTint & ThemeBackdropProps;
  windowTint: [string, string];
  powerUpColor: string | null;
  powerUpPalette: string[] | null;
  custom: ProfileTheme | null;
};

const dark = {
  dark: true,
  grain: 0.006,
  card: "rgba(18,18,18,0.5)",
  cardEdge: "rgba(0,0,0,0.35)",
  divider: "rgba(255,255,255,0.08)",

  textPrimary: "#FFFFFF",
  textTab: "#FFFFFFC7",
  textSecondary: "#FFFFFF80",
  textTertiary: "#FFFFFF59",
  icon: "#F7F5FFC6",
  iconDisabled: "#F7F5FF4D",

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
  rowSelected: "rgba(255,255,255,0.22)",
  rowHover: "rgba(255,255,255,0.07)",
  commandBarSelected: "rgba(255,255,255,0.145)",
  commandBarHover: "rgba(120,125,134,0.32)",
  selection: "rgba(120,125,134,0.7)",
  placeholder: "#FFFFFF87",
  chipBorder: "rgba(255,255,255,0.15)",
  chipText: "#FFFFFF99",
  goButton: "#DCCBD8",
  goButtonText: "#1A1418",
  goButtonIdle: "rgba(255,255,255,0.08)",

  ntpBarSolid: "#2D2D2D",
  ntpBarBorder: "rgba(120,125,134,0.32)",
  accent: "#4A77D4",
};

const light: typeof dark = {
  dark: false,
  grain: 0.05,
  card: "rgba(255,255,255,0.7)",
  cardEdge: "rgba(0,0,0,0.08)",
  divider: "rgba(0,0,0,0.08)",

  textPrimary: "#000000",
  textTab: "#000000AD",
  textSecondary: "#00000080",
  textTertiary: "#00000059",
  icon: "#000000C6",
  iconDisabled: "#0000004D",

  tabHover: "rgba(255,255,255,0.55)",
  tabPressed: "rgba(255,255,255,0.7)",
  tabSelected: "rgba(255,255,255,0.7)",
  tabSelectedText: "#000000",
  tabSelectedBorder: ["rgba(255,255,255,0.98)", "rgba(0,0,0,0.06)"],
  tabSelectedShadow: "rgba(0,0,0,0.12)",
  tabSelectedShadowRadius: 12.5,
  pinnedResting: "rgba(0,0,0,0.05)",
  pinnedRestingStroke: "rgba(0,0,0,0.18)",
  pinnedSelectedFill: "rgba(255,255,255,0.7)",
  pinnedSelectedRim: "rgba(0,0,0,0.12)",
  pinnedSelectedOutline: "rgba(255,255,255,0.98)",

  toolbarHover: "rgba(0,0,0,0.06)",
  toolbarPressed: "rgba(0,0,0,0.1)",
  urlPill: "rgba(0,0,0,0.05)",

  panel: "#FFFFFF",
  panelBorder: "rgba(0,0,0,0.1)",
  panelShadowOpacity: 0.18,
  rowSelected: "rgba(15,24,44,0.08)",
  rowHover: "rgba(15,24,44,0.05)",
  commandBarSelected: "rgba(15,24,44,0.08)",
  commandBarHover: "rgba(15,24,44,0.05)",
  selection: "rgba(120,125,134,0.4)",
  placeholder: "#00000066",
  chipBorder: "rgba(0,0,0,0.12)",
  chipText: "#00000099",
  goButton: "#0F182C",
  goButtonText: "#FFFFFF",
  goButtonIdle: "rgba(0,0,0,0.06)",

  ntpBarSolid: "#FEFFFF",
  ntpBarBorder: "rgba(0,0,0,0.07)",
  accent: "#6395FC",
};

export function hex(color: string): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b, a = "1"] = m[1]!.split(",").map((v) => v.trim());
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0").toUpperCase();
  return `#${h(+r!)}${h(+g!)}${h(+b!)}${h(+a * 255)}`;
}

type ProfileColorSpec = {
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

const INCOGNITO_TINT = "#3A3A3C";

export function profileNameColor(profile: Pick<Profile, "color" | "theme">, dark: boolean): string {
  const spec = PROFILE_COLORS[profile.color] ?? PROFILE_COLORS.plum;
  const base = profile.theme ? themeAccent(resolveTheme(profile.theme, dark)) : (spec.action ?? spec.swatch);
  return dark ? mix(base, "#FFFFFF", 0.6) : mix(base, "#000000", 0.4);
}

function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const cache = new Map<string, Theme>();

export function themeFor(key: string): Theme {
  let theme = cache.get(key);
  if (!theme) {
    const [color, mode] = key.split(":") as [ProfileColor | "incognito", string];
    const base = color === "incognito" || mode === "dark" ? dark : light;
    const spec = color === "incognito" ? null : (PROFILE_COLORS[color] ?? PROFILE_COLORS.plum);
    const powerUpColor = !spec ? null : spec.palette ? (spec.powerUp ?? spec.swatch) : "#808080A6";
    const backdrop = backdropTint(spec ? (spec.tint ?? tintForHue(spec.swatch, !spec.palette)) : INCOGNITO_TINT, !spec?.palette);
    theme = {
      ...base,
      profileColor: color,
      backdrop: { ...backdrop, ...PRESET_BACKDROP },
      windowTint: opaqueTint(backdrop, base.dark),
      powerUpColor,
      powerUpPalette: powerUpColor ? [powerUpColor] : null,
      custom: null,
    };
    cache.set(key, theme);
  }
  return theme;
}

export function nearestPreset(hexColor: string): ProfileColor {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  const hsl = (h: string) => rgbToHsl(ch(h, 0), ch(h, 1), ch(h, 2));
  const [h, s] = hsl(hexColor);
  if (s < 0.12) return "neutral";
  let best: ProfileColor = "plum";
  let distance = Infinity;
  for (const [name, spec] of Object.entries(PROFILE_COLORS) as [ProfileColor, ProfileColorSpec][]) {
    if (name === "neutral") continue;
    const [sh] = hsl(spec.swatch);
    const d = Math.min(Math.abs(sh - h), 1 - Math.abs(sh - h));
    if (d < distance) [best, distance] = [name, d];
  }
  return best;
}

const customCache = new WeakMap<ProfileTheme, Map<string, Theme>>();

function customTheme(custom: ProfileTheme, color: ProfileColor, appDark: boolean, followApp: boolean): Theme {
  const requested = followApp ? appDark : themeDark(custom, appDark);
  const key = `${color}:${requested ? "dark" : "light"}${followApp ? ":app" : ""}`;
  let byKey = customCache.get(custom);
  if (!byKey) customCache.set(custom, (byKey = new Map()));
  let theme = byKey.get(key);
  if (!theme) {
    const look = resolveTheme(custom, requested);
    const dark = followApp ? requested : readableDark(look, requested);
    const preset = themeFor(`${color}:${dark ? "dark" : "light"}`);
    const accent = themeAccent(look);
    const palette = themePalette(look);
    theme = {
      ...preset,
      profileColor: nearestPreset(accent),
      backdrop: {
        ...backdropTint(accent, false),
        ...themeBackdrop(look, dark),
        ...(dark === requested ? {} : { themeAppearance: dark ? ("dark" as const) : ("light" as const) }),
      },
      windowTint: opaqueThemeTint(look, dark),
      powerUpColor: accent,
      powerUpPalette: palette.length > 1 ? palette : [palette[0] ?? accent],
      custom,
    };
    byKey.set(key, theme);
  }
  return theme;
}

export function profileTheme(profile: Pick<Profile, "color" | "theme"> | undefined, appDark: boolean, followApp = false): Theme {
  const color = profile?.color ?? "plum";
  if (profile?.theme) return customTheme(profile.theme, color, appDark, followApp);
  return themeFor(`${color}:${appDark ? "dark" : "light"}`);
}

export function profileAccent(profile: Pick<Profile, "color" | "theme"> | undefined): string {
  if (profile?.theme) return themeAccent(profile.theme);
  return (PROFILE_COLORS[profile?.color ?? "plum"] ?? PROFILE_COLORS.plum).swatch;
}

function themeOf(s: BrowserState, windowId: string | null, page: string | null): Theme {
  const w = s.windows[windowId ?? s.ui.focusedWindowId ?? ""];
  if (w?.incognito) return themeFor("incognito");
  return profileTheme(s.profiles[page ?? w?.profileId ?? s.settings.defaultProfileId], s.ui.appDark, !windowId);
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeScope({ children }: { children: ReactNode }) {
  const windowId = useContext(WindowContext);
  const page = useContext(PageProfileContext);
  const theme = useBrowser((s) => themeOf(s, windowId, page));
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useTheme(): Theme {
  const scoped = useContext(ThemeContext);
  if (scoped) return scoped;
  if (__DEV__) console.warn("useTheme outside a ThemeScope");
  return themeOf(useBrowser.getState(), null, null);
}

export const layout = {
  sidebarWidth: 190,
  sidebarHeader: 46,
  sidebarInset: 6,
  pinnedTop: 54,
  pinnedHeight: 41,
  rowHeight: 34,
  rowGap: 3,
  cardTop: 6,
  cardInset: 7,
  cardRadius: 10,
  toolbarHeight: 41,
  toolbarButton: 30,
  toolbarIconCenters: [21, 56, 92, 127],
  breadcrumbX: 153,
  trafficLightsWidth: 78,
} as const;
