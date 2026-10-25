import type { ProfileTheme, ThemeColor, ThemeLook, ThemeMode, ThemeStop, ThemeTexture } from "../store/types";

export const MAX_THEME_STOPS = 3;
export const PAD_LIGHTNESS = 0.6;
export const THEME_TEXTURES: ThemeTexture[] = ["grain", "sand", "denim", "tweed"];

const TEXTURE_STRENGTH: Record<ThemeTexture, number> = { grain: 0.8, sand: 0.15, denim: 0.6, tweed: 0.4 };
const BASE_REACH = 0.75;
export const DEFAULT_THEME_ANGLE = 135;

export type ThemeBackdropProps = {
  themeColors: number[];
  themeOpacity: number;
  themeBaseAlpha: number;
  themeGrain: number;
  themeTexture: ThemeTexture;
  themeAppearance: ThemeMode;
  themeAngle: number;
};

export const PRESET_BACKDROP: ThemeBackdropProps = {
  themeColors: [],
  themeOpacity: 1,
  themeBaseAlpha: 0,
  themeGrain: 0,
  themeTexture: "grain",
  themeAppearance: "auto",
  themeAngle: DEFAULT_THEME_ANGLE,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function padColor(x: number, y: number, lightness = PAD_LIGHTNESS): ThemeColor {
  const dx = clamp01(x) - 0.5, dy = clamp01(y) - 0.5;
  let hue = Math.atan2(dy, dx) / (2 * Math.PI);
  if (hue < 0) hue += 1;
  const sat = Math.min(1, Math.hypot(dx, dy) / 0.5);
  const [r, g, b] = hslToRgb(hue, sat, clamp01(lightness));
  return { r, g, b, a: 1 };
}

export function padPosition(color: ThemeColor): { x: number; y: number } {
  const [h, s] = rgbToHsl(clamp01(color.r), clamp01(color.g), clamp01(color.b));
  const angle = h * 2 * Math.PI;
  return { x: 0.5 + 0.5 * s * Math.cos(angle), y: 0.5 + 0.5 * s * Math.sin(angle) };
}

type Lab = [number, number, number];

const decode = (v: number) => Math.sign(v) * (Math.abs(v) <= 0.04045 ? Math.abs(v) / 12.92 : ((Math.abs(v) + 0.055) / 1.055) ** 2.4);
const encode = (v: number) => Math.sign(v) * (Math.abs(v) <= 0.0031308 ? Math.abs(v) * 12.92 : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);

export function oklab(c: ThemeColor): Lab {
  const [r, g, b] = [c.r, c.g, c.b].map(decode) as Lab;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab([L, A, B]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(encode) as [number, number, number];
}

const toHex = (c: number[]) => `#${c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

export function colorHex(color: ThemeColor): string {
  return toHex([color.r, color.g, color.b]);
}

export function hexColor(hex: string): ThemeColor {
  const ch = (i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return { r: ch(0), g: ch(1), b: ch(2), a: 1 };
}

export function mixOklab(a: ThemeColor, b: ThemeColor, t: number): [number, number, number] {
  const [la, lb] = [oklab(a), oklab(b)];
  return fromOklab(la.map((v, i) => v + (lb[i]! - v) * t) as Lab);
}

export function lookAngle(theme: Pick<ThemeLook, "angle">): number {
  return theme.angle ?? DEFAULT_THEME_ANGLE;
}

const direction = (degrees: number) => {
  const r = (degrees * Math.PI) / 180;
  return { dx: Math.sin(r), dy: -Math.cos(r) };
};

const baseHalf = (width: number, height: number, dx: number, dy: number) =>
  (Math.hypot(width * dx, height * dy) * Math.hypot(width, height)) / (2 * Math.max(width, height));

const overlayHalf = (width: number, height: number, dx: number, dy: number) => (width * Math.abs(dx) + height * Math.abs(dy)) / 2;

function along(degrees: number, x: number, y: number, width: number, height: number, half: typeof baseHalf): number {
  const { dx, dy } = direction(degrees);
  return ((x - width / 2) * dx + (y - height / 2) * dy) / (2 * half(width, height, dx, dy)) + 0.5;
}

export function themeArea(theme: ProfileTheme, x: number, y: number, width: number, height: number): [number, number, number] {
  const [c0, c1 = c0, c2] = theme.stops.map((s) => s.color) as [ThemeColor, ThemeColor?, ThemeColor?];
  const angle = lookAngle(theme);
  const t = clamp01(along(angle, x, y, width, height, baseHalf) / BASE_REACH);
  const base = mixOklab(c0, c1, t);
  if (!c2) return base;
  const a = clamp01(along(angle + 45, x, y, width, height, overlayHalf)) * c2.a;
  return base.map((v, i) => v + ((i === 0 ? c2.r : i === 1 ? c2.g : c2.b) - v) * a) as [number, number, number];
}

export function themeDark(theme: ProfileTheme, appDark: boolean): boolean {
  return theme.mode === "auto" ? appDark : theme.mode === "dark";
}

export function resolveTheme(theme: ProfileTheme, dark: boolean): ProfileTheme {
  const { dark: darkLook, ...base } = theme;
  if (!dark || !darkLook) return base;
  const { angle: _lightAngle, ...light } = base;
  return { ...light, ...darkLook };
}

export function arcLayerAlpha(intensity: number): number {
  return 0.2 + 0.55 * clamp01(intensity);
}

export function themeLayerAlpha(theme: ProfileTheme): number {
  return 1 - clamp01(theme.translucency) * (1 - arcLayerAlpha(theme.intensity));
}

export function themeUnderlayAlpha(theme: ProfileTheme, dark: boolean): number {
  const arc = Math.min(arcLayerAlpha(theme.intensity), 0.5);
  return clamp01(theme.translucency) * (dark ? 0.35 * arc : arc);
}

export function themeGrainAlpha(theme: ProfileTheme): number {
  return clamp01(theme.grain) * TEXTURE_STRENGTH[theme.texture];
}

export function flatColors(theme: ProfileTheme): number[] {
  return theme.stops.slice(0, MAX_THEME_STOPS).flatMap((s) => [s.color.r, s.color.g, s.color.b, s.color.a]);
}

export function themeBackdrop(theme: ProfileTheme, dark: boolean): ThemeBackdropProps {
  return {
    themeColors: flatColors(theme),
    themeOpacity: themeLayerAlpha(theme),
    themeBaseAlpha: themeUnderlayAlpha(theme, dark),
    themeGrain: themeGrainAlpha(theme),
    themeTexture: theme.texture,
    themeAppearance: theme.mode,
    themeAngle: lookAngle(theme),
  };
}

export function themeAccent(theme: ProfileTheme): string {
  return toHex(themeArea(theme, 0.5, 0.5, 1, 1));
}

export function themePalette(theme: ProfileTheme): string[] {
  return theme.stops.map((s) => colorHex(s.color));
}

function underGrey(theme: ProfileTheme, dark: boolean): number {
  const u = themeUnderlayAlpha(theme, dark);
  const blur = dark ? 0.16 : 0.92;
  return (dark ? 0 : 1) * u + blur * (1 - u);
}

export function themeUnderColor(theme: ProfileTheme, dark: boolean): string {
  const grey = underGrey(theme, dark);
  return toHex([grey, grey, grey]);
}

function composite(theme: ProfileTheme, dark: boolean, x: number, y: number): number[] {
  const a = themeLayerAlpha(theme);
  const under = underGrey(theme, dark);
  return themeArea(theme, x, y, 1, 1).map((v) => a * clamp01(v) + (1 - a) * under);
}

export function opaqueThemeTint(theme: ProfileTheme, dark: boolean): [string, string] {
  return [toHex(composite(theme, dark, 0, 0)), toHex(composite(theme, dark, 1, 1))];
}

const SAMPLE_POINTS = [0, 0.5, 1];
const MIN_BLACK_TEXT_CONTRAST = 3;
const MIN_WHITE_TEXT_CONTRAST = 2;

const relativeLuminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => decode(clamp01(v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function themeLuminance(theme: ProfileTheme, dark: boolean): number {
  let sum = 0;
  for (const x of SAMPLE_POINTS) for (const y of SAMPLE_POINTS) sum += relativeLuminance(composite(theme, dark, x, y));
  return sum / SAMPLE_POINTS.length ** 2;
}

export function readableDark(theme: ProfileTheme, dark: boolean): boolean {
  const y = themeLuminance(theme, dark);
  const blackText = (y + 0.05) / 0.05, whiteText = 1.05 / (y + 0.05);
  if (dark) return !(whiteText < MIN_WHITE_TEXT_CONTRAST && blackText > whiteText);
  return blackText < MIN_BLACK_TEXT_CONTRAST && whiteText > blackText;
}

export function stopLightness(stop: ThemeStop): number {
  return rgbToHsl(clamp01(stop.color.r), clamp01(stop.color.g), clamp01(stop.color.b))[2];
}

export function withStopAt(theme: ProfileTheme, index: number, x: number, y: number): ProfileTheme {
  const stops = theme.stops.map((s, i) => (i === index ? { x, y, color: { ...padColor(x, y, stopLightness(s)), a: s.color.a } } : s));
  return { ...theme, stops };
}

export function withStopLightness(theme: ProfileTheme, index: number, lightness: number): ProfileTheme {
  const stops = theme.stops.map((s, i) => (i === index ? { ...s, color: { ...padColor(s.x, s.y, lightness), a: s.color.a } } : s));
  return { ...theme, stops };
}

export function withAngle(theme: ProfileTheme, degrees: number): ProfileTheme {
  return { ...theme, angle: ((Math.round(degrees) % 360) + 360) % 360 };
}

export function withAddedStop(theme: ProfileTheme): ProfileTheme {
  if (theme.stops.length >= MAX_THEME_STOPS) return theme;
  const last = theme.stops[theme.stops.length - 1] ?? { x: 0.8, y: 0.5 };
  const angle = Math.atan2(last.y - 0.5, last.x - 0.5) + (2 * Math.PI) / 5;
  const radius = Math.max(0.3, Math.hypot(last.x - 0.5, last.y - 0.5));
  const x = 0.5 + radius * Math.cos(angle), y = 0.5 + radius * Math.sin(angle);
  return { ...theme, stops: [...theme.stops, { x, y, color: padColor(x, y) }] };
}

export function withoutStop(theme: ProfileTheme, index: number): ProfileTheme {
  if (theme.stops.length <= 1) return theme;
  return { ...theme, stops: theme.stops.filter((_, i) => i !== index) };
}

export function startingTheme(swatch: string): ProfileTheme {
  const base = padPosition(hexColor(swatch));
  const angle = Math.atan2(base.y - 0.5, base.x - 0.5);
  const radius = Math.max(0.3, Math.hypot(base.x - 0.5, base.y - 0.5));
  const stop = (offset: number): ThemeStop => {
    const x = 0.5 + radius * Math.cos(angle + offset), y = 0.5 + radius * Math.sin(angle + offset);
    return { x, y, color: padColor(x, y) };
  };
  return { stops: [stop(-0.45), stop(0.45)], intensity: 0.6, mode: "auto", grain: 0, texture: "grain", translucency: 1 };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function sanitizeColor(v: unknown): ThemeColor | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const parts = [c.r, c.g, c.b];
  if (!parts.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 4)) return null;
  return { r: c.r as number, g: c.g as number, b: c.b as number, a: clamp01(num(c.a, 1)) };
}

const MAX_SANITIZED_STOPS = 16;

function sanitizeLook(v: unknown): ThemeLook | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if (!Array.isArray(t.stops)) return null;
  const stops: ThemeStop[] = [];
  for (const raw of t.stops.slice(0, MAX_SANITIZED_STOPS)) {
    if (stops.length >= MAX_THEME_STOPS) break;
    const s = raw as Record<string, unknown> | null;
    const color = sanitizeColor(s?.color);
    if (color) stops.push({ color, x: clamp01(num(s!.x, 0.5)), y: clamp01(num(s!.y, 0.5)) });
  }
  if (!stops.length) return null;
  return {
    stops,
    intensity: clamp01(num(t.intensity, 0.6)),
    grain: clamp01(num(t.grain, 0)),
    texture: THEME_TEXTURES.includes(t.texture as ThemeTexture) ? (t.texture as ThemeTexture) : "grain",
    translucency: clamp01(num(t.translucency, 1)),
    ...(typeof t.angle === "number" && Number.isFinite(t.angle) ? { angle: ((t.angle % 360) + 360) % 360 } : {}),
  };
}

export function sanitizeTheme(v: unknown): ProfileTheme | null {
  const look = sanitizeLook(v);
  if (!look) return null;
  const t = v as Record<string, unknown>;
  const dark = sanitizeLook(t.dark);
  return { ...look, mode: t.mode === "light" || t.mode === "dark" ? t.mode : "auto", ...(dark ? { dark } : {}) };
}
