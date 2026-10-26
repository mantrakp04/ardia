import { padPosition, sanitizeTheme, THEME_TEXTURES } from "../../lib/profileLook";
import type { ProfileTheme, ThemeColor, ThemeLook, ThemeMode, ThemeTexture } from "../browser/types";

type Json = Record<string, unknown>;

export const MAX_ARC_THEME_JSON = 64 * 1024;

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const payload = (v: unknown): unknown => obj(v)?._0;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const firstItems = (v: unknown, n: number): unknown[] => (Array.isArray(v) ? v.slice(0, n) : []);

function arcColor(v: unknown): ThemeColor | null {
  const c = obj(v);
  if (!c) return null;
  const r = num(c.red), g = num(c.green), b = num(c.blue);
  if (r === null || g === null || b === null) return null;
  return { r, g, b, a: num(c.alpha) ?? 1 };
}

type Appearance = "light" | "dark";
const isAppearance = (v: unknown): v is Appearance => v === "light" || v === "dark";

function windowMode(v: unknown): ThemeMode | null {
  const wrapper = obj(v);
  if (!wrapper) return null;
  const single = payload(wrapper.single);
  if (isAppearance(single)) return single;
  const based = obj(wrapper.appearanceBased);
  if (!based || !isAppearance(based.light) || !isAppearance(based.dark)) return null;
  return based.light === based.dark ? based.light : "auto";
}

type ParsedLook = { look: ThemeLook; style: unknown };

function parseLook(background: unknown): ParsedLook | null {
  const kind = obj(payload(obj(obj(background)?.style)?.color));
  if (!kind) return null;
  const gradient = obj(payload(kind.blendedGradient));
  const single = obj(payload(kind.blendedSingleColor));
  const basic = obj(payload(kind.basicColor));
  const config = gradient ?? single ?? basic;
  if (!config) return null;

  let colors: ThemeColor[];
  if (gradient) {
    const base = firstItems(gradient.baseColors, 2).map(arcColor).filter((c): c is ThemeColor => !!c);
    const overlay = firstItems(gradient.overlayColors, 2).map(arcColor).filter((c): c is ThemeColor => !!c);
    const third = overlay.length > 1 ? overlay[1] : undefined;
    colors = third && base.length ? [...(base.length === 1 ? [base[0]!, base[0]!] : base), third] : base;
  } else {
    const color = arcColor(config.color);
    colors = color ? [color] : [];
  }
  if (!colors.length) return null;

  const modifiers = obj(config.modifiers);
  return {
    look: {
      stops: colors.map((color) => ({ color, ...padPosition(color) })),
      intensity: num(modifiers?.intensityFactor) ?? 1,
      grain: basic ? 0 : (num(modifiers?.noiseFactor) ?? 0),
      texture: THEME_TEXTURES.includes(modifiers?.overlay as ThemeTexture) ? (modifiers!.overlay as ThemeTexture) : "grain",
      translucency: basic ? 0 : 1,
    },
    style: config.translucencyStyle,
  };
}

export function parseArcTheme(input: unknown): ProfileTheme | null {
  let raw = input;
  if (typeof raw === "string") {
    if (raw.length > MAX_ARC_THEME_JSON) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const theme = obj(raw);
  const background = obj(theme?.background);
  if (!theme || !background) return null;

  const single = parseLook(payload(background.single));
  const based = obj(background.appearanceBased);
  const light = single ?? parseLook(based?.light);
  const dark = single ? null : parseLook(based?.dark);
  const main = light ?? dark;
  if (!main) return null;

  const forced = windowMode(theme.windowAppearance);
  const style = main.style;
  const mode: ThemeMode = forced ?? (light && dark ? "auto" : isAppearance(style) ? style : "auto");
  const base = mode === "dark" && dark ? dark : main;

  return sanitizeTheme({
    ...base.look,
    mode,
    ...(light && dark && mode === "auto" ? { dark: dark.look } : {}),
  });
}
