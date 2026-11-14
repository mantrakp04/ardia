import type { FontFace } from "./googleFonts";
import { BOOST_FONTS, type Boost, type BoostColors } from "./types";
import { safeSelector } from "./valid";

export type EngineBoost = {
  id: string;
  domain: string;
  subdomains: boolean;
  css: string;
  js: string;
  zoom: number;
  color: number[] | null;
  scheme: 0 | 1 | null;
};

const TEXT_ONLY = "*:not(i, .material-symbols-outlined, .material-icons)";
const TEXT_TRANSFORM = { lower: "lowercase", upper: "uppercase", title: "capitalize" } as const;

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const quoted = (family: string) => `"${family.replace(/[\\"]/g, "\\$&")}"`;

export function colorMatrix(colors: BoostColors): number[] {
  const primary = colors.hue / 360;
  const secondary = (colors.hue + colors.offset) / 360;
  const spread = clamp(colors.saturation, 0, 1) * (1 - colors.contrast) * 0.2;
  const shift = 0.2 * clamp(colors.brightness, -1, 1);
  const lightness = colors.invert ? [0, 0, 3 * spread - 1, 0, 1 - spread + shift] : [0, 0, 1 - 3 * spread, 0, 2 * spread + shift];
  return [0, 0, primary - secondary, 0, secondary, 0, colors.originalSaturation, 0, 0, (1 - colors.originalSaturation) * colors.saturation, ...lightness, 0, 0, 0, 1, 0];
}

const fontFaceRule = (family: string, face: FontFace) =>
  `@font-face{font-family:${quoted(family)};font-style:normal;font-weight:${face.weight};src:url(data:font/woff2;base64,${face.data}) format("woff2");}`;

export function boostStylesheet(boost: Pick<Boost, "zaps" | "font" | "textCase" | "css">, faces: FontFace[] = []): string {
  const font = boost.font;
  const rules = font ? faces.map((face) => fontFaceRule(font, face)) : [];
  rules.push(...boost.zaps.filter(safeSelector).map((selector) => `${selector}{display:none !important;}`));
  if (font && (faces.length || (BOOST_FONTS as readonly string[]).includes(font))) rules.push(`${TEXT_ONLY}{font-family:${quoted(font)} !important;}`);
  if (boost.textCase !== "none") rules.push(`${TEXT_ONLY}{text-transform:${TEXT_TRANSFORM[boost.textCase]} !important;}`);
  if (boost.css) rules.push(boost.css);
  return rules.join("\n");
}

const MAX_ENGINE_SOURCE_BYTES = 1024 * 1024;
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
export const fitsEngine = (boost: EngineBoost) => utf8Bytes(boost.css) <= MAX_ENGINE_SOURCE_BYTES && utf8Bytes(boost.js) <= MAX_ENGINE_SOURCE_BYTES;

const MAX_ENGINE_BOOSTS = 1000;
const MAX_ENGINE_LIST_BYTES = 32 * 1024 * 1024;
export function fitEngineList(boosts: EngineBoost[]) {
  const kept: EngineBoost[] = [];
  let bytes = 2;
  for (const boost of boosts) {
    if (kept.length >= MAX_ENGINE_BOOSTS) break;
    const next = bytes + utf8Bytes(JSON.stringify(boost)) + (kept.length ? 1 : 0);
    if (next > MAX_ENGINE_LIST_BYTES) continue;
    bytes = next;
    kept.push(boost);
  }
  return kept;
}

export function compileBoost(boost: Boost, faces: FontFace[] = []): EngineBoost {
  const compiled: EngineBoost = {
    id: boost.id,
    domain: boost.domain,
    subdomains: boost.subdomains,
    css: boostStylesheet(boost, faces),
    js: boost.js,
    zoom: boost.size,
    color: boost.colors ? colorMatrix(boost.colors) : null,
    scheme: boost.colors?.appearance === "dark" ? 1 : boost.colors?.appearance === "light" ? 0 : null,
  };
  return faces.length && !fitsEngine(compiled) ? compileBoost(boost) : compiled;
}
