import type { ScopeState } from "../scopeState.ts";

export type ThemeMode = "auto" | "light" | "dark";
export type ThemeTexture = "grain" | "sand" | "denim" | "tweed";
export type ViewThemeStop = { r: number; g: number; b: number; a: number; x: number; y: number };
export type ViewThemeLook = { stops: ViewThemeStop[]; intensity: number; grain: number; texture: ThemeTexture; translucency: number; angle: number };
export type ViewTheme = { colors: string[]; darkColors: string[] | null; mode: ThemeMode; light: ViewThemeLook; dark: ViewThemeLook | null };
export type ViewLookSettings = {
  appearance: "auto" | "light" | "dark" | null;
  interfaceStyle: "glass" | "classic" | null;
  glassTintWithTheme: boolean | null;
  glassTintAmount: number | null;
  selectedTabGlow: "full" | "soft" | "off" | null;
  pageFrame: number | null;
  sidebarSide: "left" | "right" | null;
  profileSwitcherIcons: boolean | null;
};

type Fields = Record<string, unknown>;

const TEXTURES: readonly ThemeTexture[] = ["grain", "sand", "denim", "tweed"];
const MAX_THEME_STOPS = 3;
const MAX_SCANNED_STOPS = 16;
const MAX_CHANNEL = 4;
const DEFAULT_THEME_ANGLE = 135;
const PAGE_FRAME_MAX = 12;

const isFields = (v: unknown): v is Fields => !!v && typeof v === "object";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const numberOr = (v: unknown, fallback: number) => (isNumber(v) ? v : fallback);
const angleOf = (v: unknown) => (isNumber(v) ? ((v % 360) + 360) % 360 : undefined);

function hexByte(v: number) {
  return Math.round(clamp01(v) * 255).toString(16).padStart(2, "0").toUpperCase();
}

const hexOf = (s: ViewThemeStop) => `#${hexByte(s.r)}${hexByte(s.g)}${hexByte(s.b)}${s.a < 1 ? hexByte(s.a) : ""}`;

function stopOf(raw: unknown): ViewThemeStop | null {
  const color = isFields(raw) ? raw.color : null;
  if (!isFields(color) || ![color.r, color.g, color.b].every((n) => isNumber(n) && Math.abs(n) < MAX_CHANNEL)) return null;
  const at = raw as Fields;
  return { r: color.r as number, g: color.g as number, b: color.b as number, a: clamp01(numberOr(color.a, 1)), x: clamp01(numberOr(at.x, 0.5)), y: clamp01(numberOr(at.y, 0.5)) };
}

function lookOf(raw: unknown, angle: number | undefined): ViewThemeLook | null {
  if (!isFields(raw) || !Array.isArray(raw.stops)) return null;
  const stops: ViewThemeStop[] = [];
  for (const candidate of raw.stops.slice(0, MAX_SCANNED_STOPS)) {
    if (stops.length >= MAX_THEME_STOPS) break;
    const stop = stopOf(candidate);
    if (stop) stops.push(stop);
  }
  if (!stops.length) return null;
  return {
    stops,
    intensity: clamp01(numberOr(raw.intensity, 0.6)),
    grain: clamp01(numberOr(raw.grain, 0)),
    texture: TEXTURES.includes(raw.texture as ThemeTexture) ? (raw.texture as ThemeTexture) : "grain",
    translucency: clamp01(numberOr(raw.translucency, 1)),
    angle: angle ?? DEFAULT_THEME_ANGLE,
  };
}

export function themeOf(app: ScopeState, syncId: string, legacy: unknown): ViewTheme | null {
  const record = app.records[`pth:${syncId}`]?.v;
  const raw = record ? (isFields(record) && record.preset !== true ? record.t : null) : legacy;
  if (!isFields(raw)) return null;
  const angles = isFields(record) ? app.records[`pth:${syncId}:angle`]?.v : undefined;
  const fromRecord = isFields(angles);
  const darkRaw = isFields(raw.dark) ? raw.dark : null;
  const light = lookOf(raw, angleOf(fromRecord ? angles.a : raw.angle));
  if (!light) return null;
  const dark = lookOf(darkRaw, angleOf(fromRecord ? angles.d : darkRaw?.angle));
  return {
    colors: light.stops.map(hexOf),
    darkColors: dark ? dark.stops.map(hexOf) : null,
    mode: raw.mode === "light" || raw.mode === "dark" ? raw.mode : "auto",
    light,
    dark,
  };
}

export function settingOf(app: ScopeState, name: string): unknown {
  const record = app.records[`set:${name}`]?.v;
  return isFields(record) ? record.v : undefined;
}

export function lookSettingsOf(app: ScopeState): ViewLookSettings | null {
  const oneOf = <T extends string>(name: string, values: readonly T[]): T | null => {
    const v = settingOf(app, name);
    return values.includes(v as T) ? (v as T) : null;
  };
  const flag = (name: string) => {
    const v = settingOf(app, name);
    return typeof v === "boolean" ? v : null;
  };
  const amount = settingOf(app, "glassTintAmount");
  const frame = settingOf(app, "pageFrame");
  const settings: ViewLookSettings = {
    appearance: oneOf("appearance", ["auto", "light", "dark"]),
    interfaceStyle: oneOf("interfaceStyle", ["glass", "classic"]),
    glassTintWithTheme: flag("glassTintWithTheme"),
    glassTintAmount: isNumber(amount) && amount >= 0 && amount <= 1 ? amount : null,
    selectedTabGlow: oneOf("selectedTabGlow", ["full", "soft", "off"]),
    pageFrame: Number.isInteger(frame) && (frame as number) >= 0 && (frame as number) <= PAGE_FRAME_MAX ? (frame as number) : null,
    sidebarSide: oneOf("sidebarSide", ["left", "right"]),
    profileSwitcherIcons: flag("profileSwitcherIcons"),
  };
  return Object.values(settings).some((v) => v !== null) ? settings : null;
}
