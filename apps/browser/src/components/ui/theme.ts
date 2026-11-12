import { createContext, useContext } from "react";
import { opaqueThemeTint, PRESET_BACKDROP, resolveTheme, requestedDarkFor, shownLook, themeAccent, themeBackdrop, themePalette, type LookSource, type ProfileColor, type ProfileLookFields, type ProfileTheme } from "../../lib/profileLook";
import type { ThemeBackdropProps } from "@ardia/core";
import { backdropTint, opaqueTint, tintForHue, type BackdropTint } from "../../lib/windowTint";
import { isRgbFunction, luminance, mix, over, parseColor, rgbToHsl, toHex } from "../../lib/color";
import { CARD_INSET, DEFAULT_SIDEBAR_WIDTH } from "../../lib/windowLayout";
import { SIDEBAR_ROW } from "../../lib/sidebarMetrics";
import { arcSelectedFill, colorRoles, ink, INCOGNITO_TINT, PROFILE_COLORS, radius, type ColorRoles, type ProfileColorSpec, type ShadowLevel } from "./tokens";
import type { BasePalette } from "../../lib/themeFile";
import { visibleSelection } from "../../lib/selectionContrast";

export { PROFILE_COLORS } from "./tokens";

export type Theme = ColorRoles & {
  rowSelectedText: string;
  adaptiveInk: boolean;
  profileColor: ProfileColor | "incognito";
  backdrop: BackdropTint & ThemeBackdropProps;
  windowTint: [string, string];
  powerUpColor: string | null;
  powerUpPalette: string[] | null;
  custom: ProfileTheme | null;
  palettes: Palettes;
};

type Palettes = { readonly dark: ColorRoles; readonly light: ColorRoles; readonly revision: number };
type Layer = { palettes: Palettes; themes: Map<string, Theme>; custom: WeakMap<ProfileTheme, Map<string, Theme>> };

const OWN_PALETTE: BasePalette = { revision: 0, dark: colorRoles.dark, light: colorRoles.light };
const layers = new WeakMap<BasePalette, Layer>();

function layerOf(base: BasePalette | null | undefined): Layer {
  const palette = base ?? OWN_PALETTE;
  let layer = layers.get(palette);
  if (!layer) {
    const palettes = { dark: palette.dark as unknown as ColorRoles, light: palette.light as unknown as ColorRoles, revision: palette.revision };
    layers.set(palette, (layer = { palettes, themes: new Map(), custom: new WeakMap() }));
  }
  return layer;
}

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

const MIN_INK_CONTRAST = 3;

function contrast(text: string, row: string): number {
  const [a, b] = [luminance(text), luminance(row)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function inkOn(rows: readonly string[], dark: boolean): string {
  const worst = (text: string) => Math.min(...rows.map((row) => contrast(text, row)));
  const [own, other] = dark ? [ink.white, ink.black] : [ink.black, ink.white];
  return worst(own) >= MIN_INK_CONTRAST || worst(other) <= worst(own) ? own : other;
}

function arcSelectionRoles(base: ColorRoles, windowTint: readonly string[], adaptiveInk: boolean): Pick<Theme, "tabSelected" | "pinnedSelectedFill" | "rowSelectedText" | "tabSelectedText"> {
  const tabSelected = base.dark ? arcSelectedFill.dark : visibleSelection(arcSelectedFill.light, ink.black, windowTint);
  const inkOver = (fill: string) => (adaptiveInk ? inkOn(windowTint.map((tint) => over(fill, tint)), base.dark) : base.tabSelectedText);
  return {
    tabSelected,
    pinnedSelectedFill: visibleSelection(base.pinnedSelectedFill, base.dark ? ink.white : ink.black, windowTint),
    rowSelectedText: inkOver(tabSelected),
    tabSelectedText: inkOver(base.card),
  };
}

const tintThemes = new WeakMap<Theme, Theme>();
const windowThemes = new WeakMap<Theme, Theme>();

export function tintTheme(theme: Theme): Theme {
  if (!theme.adaptiveInk) return theme;
  let tint = tintThemes.get(theme);
  if (!tint) {
    const keepsOwnInk = inkOn(theme.windowTint, theme.dark) === (theme.dark ? ink.white : ink.black);
    const other = theme.dark ? theme.palettes.light : theme.palettes.dark;
    tint = keepsOwnInk ? theme : { ...theme, ...other, tabSelected: theme.tabSelected, pinnedSelectedFill: theme.pinnedSelectedFill, rowSelectedText: theme.rowSelectedText };
    tintThemes.set(theme, tint);
    if (tint !== theme) windowThemes.set(tint, theme);
  }
  return tint;
}

export function surfaceTheme(theme: Theme): Theme {
  return windowThemes.get(theme) ?? theme;
}

export function themeFor(key: string, palette?: BasePalette | null): Theme {
  const layer = layerOf(palette);
  let theme = layer.themes.get(key);
  if (!theme) {
    const [color, mode] = key.split(":") as [ProfileColor | "incognito", string];
    const base = color === "incognito" || mode === "dark" ? layer.palettes.dark : layer.palettes.light;
    const spec = color === "incognito" ? null : (PROFILE_COLORS[color] ?? PROFILE_COLORS.plum);
    const powerUpColor = !spec ? null : spec.palette ? (spec.powerUp ?? spec.swatch) : ink.neutralGrey;
    const backdrop = backdropTint(spec ? (spec.tint ?? tintForHue(spec.swatch, !spec.palette)) : INCOGNITO_TINT, !spec?.palette);
    theme = {
      ...base,
      rowSelectedText: base.tabSelectedText,
      adaptiveInk: false,
      profileColor: color,
      backdrop: { ...backdrop, ...PRESET_BACKDROP },
      windowTint: opaqueTint(backdrop, base.dark),
      powerUpColor,
      powerUpPalette: powerUpColor ? [powerUpColor] : null,
      custom: null,
      palettes: layer.palettes,
    };
    layer.themes.set(key, theme);
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

function customTheme(custom: ProfileTheme, color: ProfileColor, appDark: boolean, source: LookSource, base: BasePalette | null | undefined, adaptiveInk: boolean): Theme {
  const key = `${color}:${requestedDarkFor(custom, appDark, source) ? "dark" : "light"}:${source}:${adaptiveInk ? "adaptive" : "mode"}`;
  const layer = layerOf(base);
  let byKey = layer.custom.get(custom);
  if (!byKey) layer.custom.set(custom, (byKey = new Map()));
  let theme = byKey.get(key);
  if (!theme) {
    const { look, dark, requestedDark } = shownLook(custom, appDark, source);
    const preset = themeFor(`${color}:${dark ? "dark" : "light"}`, base);
    const accent = themeAccent(look);
    const palette = themePalette(look);
    const windowTint = opaqueThemeTint(look, dark);
    theme = {
      ...preset,
      ...arcSelectionRoles(dark ? preset.palettes.dark : preset.palettes.light, windowTint, adaptiveInk),
      adaptiveInk,
      profileColor: nearestPreset(accent),
      backdrop: {
        ...backdropTint(accent, false),
        ...themeBackdrop(look, dark),
        ...(dark !== requestedDark ? { themeAppearance: dark ? ("dark" as const) : ("light" as const) } : source === "own" ? {} : { themeAppearance: "auto" as const }),
      },
      windowTint,
      powerUpColor: accent,
      powerUpPalette: palette.length > 1 ? palette : [palette[0] ?? accent],
      custom,
    };
    byKey.set(key, theme);
  }
  return theme;
}

export function profileTheme(profile: ProfileLookFields | undefined, appDark: boolean, source: LookSource = "own", palette?: BasePalette | null, adaptTextToColor = true): Theme {
  const color = profile?.color ?? "plum";
  if (profile?.theme) return customTheme(profile.theme, color, appDark, source, palette, adaptTextToColor);
  return themeFor(`${color}:${appDark ? "dark" : "light"}`, palette);
}

export function profileAccent(profile: ProfileLookFields | undefined): string {
  if (profile?.theme) return themeAccent(profile.theme);
  return (PROFILE_COLORS[profile?.color ?? "plum"] ?? PROFILE_COLORS.plum).swatch;
}

export function scopedTheme(incognito: boolean, profile: ProfileLookFields | undefined, appDark: boolean, source: LookSource, palette?: BasePalette | null, adaptTextToColor = true): Theme {
  return incognito ? themeFor("incognito", palette) : profileTheme(profile, appDark, source, palette, adaptTextToColor);
}

export function shadowOpacityOf(level: Omit<ShadowLevel, "opacity"> & { opacity: ShadowLevel["opacity"] | number }, theme: Theme): number {
  if (typeof level.opacity === "number") return level.opacity;
  if (level.panelShare !== undefined) return theme.panelShadowOpacity * level.panelShare;
  return theme.dark ? level.opacity.dark : level.opacity.light;
}

export const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const scoped = useContext(ThemeContext);
  if (scoped) return scoped;
  if (__DEV__) console.warn("useTheme outside a ThemeScope");
  return themeFor("plum:dark");
}

const SELECTED_TAB_GLOW = {
  full: { opacity: 1, spread: 1 },
  soft: { opacity: 0.45, spread: 0.6 },
  off: { opacity: 0, spread: 1 },
};

export type SelectedTabGlowLevel = keyof typeof SELECTED_TAB_GLOW;

export function selectedTabGlow(theme: Theme, setting: SelectedTabGlowLevel) {
  const level = SELECTED_TAB_GLOW[setting] ?? SELECTED_TAB_GLOW.full;
  return { shadowColor: hex(theme.tabSelectedShadow), shadowOpacity: level.opacity, shadowRadius: theme.tabSelectedShadowRadius * level.spread };
}

const SIDEBAR_INSET = CARD_INSET;

export const layout = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarHeader: 46,
  sidebarInset: SIDEBAR_INSET,
  pinnedTop: 54,
  pinnedHeight: 41,
  rowHeight: SIDEBAR_ROW.height,
  rowGap: SIDEBAR_ROW.gap,
  cardRadius: radius.chrome,
  toolbarButton: 30,
  toolbarIconCenters: [21, 56, 92, 127],
  breadcrumbX: 153,
  trafficLightsWidth: 78,
} as const;
