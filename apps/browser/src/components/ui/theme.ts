import { createContext, useContext } from "react";
import { opaqueThemeTint, PRESET_BACKDROP, resolveTheme, requestedDarkFor, shownLook, themeAccent, themeBackdrop, themePalette, type LookSource, type ProfileColor, type ProfileLookFields, type ProfileTheme } from "../../lib/profileLook";
import type { ThemeBackdropProps } from "@ardia/core";
import { backdropTint, opaqueTint, tintForHue, type BackdropTint } from "../../lib/windowTint";
import { isRgbFunction, mix, parseColor, rgbToHsl, toHex } from "../../lib/color";
import { CARD_INSET, DEFAULT_SIDEBAR_WIDTH } from "../../lib/windowLayout";
import { SIDEBAR_ROW } from "../../lib/sidebarMetrics";
import { colorRoles, ink, INCOGNITO_TINT, PROFILE_COLORS, type ColorRoles, type ProfileColorSpec } from "./tokens";

export { PROFILE_COLORS } from "./tokens";

export type Theme = ColorRoles & {
  profileColor: ProfileColor | "incognito";
  backdrop: BackdropTint & ThemeBackdropProps;
  windowTint: [string, string];
  powerUpColor: string | null;
  powerUpPalette: string[] | null;
  custom: ProfileTheme | null;
};

export function hex(color: string): string {
  if (!isRgbFunction(color)) return color;
  const [r, g, b, a] = parseColor(color);
  return toHex([r, g, b, a * 255]);
}

export function profileNameColor(profile: ProfileLookFields, dark: boolean): string {
  const spec = PROFILE_COLORS[profile.color] ?? PROFILE_COLORS.plum;
  const base = profile.theme ? themeAccent(resolveTheme(profile.theme, dark)) : (spec.action ?? spec.swatch);
  return dark ? mix(base, ink.white, 0.6) : mix(base, ink.black, 0.4);
}

const cache = new Map<string, Theme>();

export function themeFor(key: string): Theme {
  let theme = cache.get(key);
  if (!theme) {
    const [color, mode] = key.split(":") as [ProfileColor | "incognito", string];
    const base = color === "incognito" || mode === "dark" ? colorRoles.dark : colorRoles.light;
    const spec = color === "incognito" ? null : (PROFILE_COLORS[color] ?? PROFILE_COLORS.plum);
    const powerUpColor = !spec ? null : spec.palette ? (spec.powerUp ?? spec.swatch) : ink.neutralGrey;
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
  const hsl = (color: string) => {
    const [r, g, b] = parseColor(color);
    return rgbToHsl(r / 255, g / 255, b / 255);
  };
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

function customTheme(custom: ProfileTheme, color: ProfileColor, appDark: boolean, source: LookSource): Theme {
  const key = `${color}:${requestedDarkFor(custom, appDark, source) ? "dark" : "light"}:${source}`;
  let byKey = customCache.get(custom);
  if (!byKey) customCache.set(custom, (byKey = new Map()));
  let theme = byKey.get(key);
  if (!theme) {
    const { look, dark, requestedDark } = shownLook(custom, appDark, source);
    const preset = themeFor(`${color}:${dark ? "dark" : "light"}`);
    const accent = themeAccent(look);
    const palette = themePalette(look);
    theme = {
      ...preset,
      profileColor: nearestPreset(accent),
      backdrop: {
        ...backdropTint(accent, false),
        ...themeBackdrop(look, dark),
        ...(dark !== requestedDark ? { themeAppearance: dark ? ("dark" as const) : ("light" as const) } : source === "own" ? {} : { themeAppearance: "auto" as const }),
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

export function profileTheme(profile: ProfileLookFields | undefined, appDark: boolean, source: LookSource = "own"): Theme {
  const color = profile?.color ?? "plum";
  if (profile?.theme) return customTheme(profile.theme, color, appDark, source);
  return themeFor(`${color}:${appDark ? "dark" : "light"}`);
}

export function profileAccent(profile: ProfileLookFields | undefined): string {
  if (profile?.theme) return themeAccent(profile.theme);
  return (PROFILE_COLORS[profile?.color ?? "plum"] ?? PROFILE_COLORS.plum).swatch;
}

export function scopedTheme(incognito: boolean, profile: ProfileLookFields | undefined, appDark: boolean, source: LookSource): Theme {
  return incognito ? themeFor("incognito") : profileTheme(profile, appDark, source);
}

export const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const scoped = useContext(ThemeContext);
  if (scoped) return scoped;
  if (__DEV__) console.warn("useTheme outside a ThemeScope");
  return themeFor("plum:dark");
}

const SELECTED_TAB_GLOW = {
  full: { opacity: 1, radius: 1 },
  soft: { opacity: 0.45, radius: 0.6 },
  off: { opacity: 0, radius: 1 },
};

export type SelectedTabGlowLevel = keyof typeof SELECTED_TAB_GLOW;

export function selectedTabGlow(theme: Theme, setting: SelectedTabGlowLevel) {
  const level = SELECTED_TAB_GLOW[setting] ?? SELECTED_TAB_GLOW.full;
  return { shadowColor: hex(theme.tabSelectedShadow), shadowOpacity: level.opacity, shadowRadius: theme.tabSelectedShadowRadius * level.radius };
}

const SIDEBAR_INSET = 6;

export const layout = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarHeader: 46,
  sidebarInset: SIDEBAR_INSET,
  pinnedTop: 54,
  pinnedHeight: 41,
  rowHeight: SIDEBAR_ROW.height,
  rowGap: SIDEBAR_ROW.gap,
  cardInset: CARD_INSET,
  sidebarCardGap: CARD_INSET - SIDEBAR_INSET,
  cardRadius: 10,
  toolbarButton: 30,
  toolbarIconCenters: [21, 56, 92, 127],
  breadcrumbX: 153,
  trafficLightsWidth: 78,
} as const;

export type FormColors = {
  group: string;
  groupBorder: string;
  separator: string;
  control: string;
  controlHover: string;
  controlPressed: string;
  controlBorder: string;
  field: string;
  fieldBorder: string;
  switchOff: string;
  accent: string;
  destructive: string;
  selected: string;
  flash: string;
};

const formColorsOf = (roles: ColorRoles): FormColors => ({
  group: roles.groupFill,
  groupBorder: roles.groupBorder,
  separator: roles.divider,
  control: roles.control,
  controlHover: roles.controlHover,
  controlPressed: roles.controlPressed,
  controlBorder: roles.controlBorder,
  field: roles.field,
  fieldBorder: roles.fieldBorder,
  switchOff: roles.switchOff,
  accent: roles.formAccent,
  destructive: roles.destructive,
  selected: roles.rowHover,
  flash: roles.searchFlash,
});

const FORM_COLORS = { dark: formColorsOf(colorRoles.dark), light: formColorsOf(colorRoles.light) };

export function useFormColors(): FormColors {
  return useTheme().dark ? FORM_COLORS.dark : FORM_COLORS.light;
}
