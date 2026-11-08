import { isHexColor, isLight, luminance, mix } from "../../lib/color";
import { HIGHLIGHT_PUSH } from "./tokens";

export type VaultHighlight = { fill: string; onLight: boolean };

const MIN_SEPARATION = 1.6;
const STEP = 0.1;

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

function apartFrom(fill: string, surface: string): string {
  const toward = isLight(surface) ? HIGHLIGHT_PUSH.darker : HIGHLIGHT_PUSH.lighter;
  let shown = fill;
  for (let t = STEP; contrast(shown, surface) < MIN_SEPARATION && t <= 1; t += STEP) shown = mix(fill, toward, t);
  return shown;
}

export function vaultHighlight(websiteColor: string | null, extendWebsiteColor: boolean, frameColor: string | null, fallback: string, surface: string): VaultHighlight {
  const site = extendWebsiteColor && websiteColor && isHexColor(websiteColor) ? websiteColor.slice(0, 7) : null;
  const frame = frameColor && isHexColor(frameColor) ? frameColor.slice(0, 7) : null;
  const fill = apartFrom(site ?? frame ?? fallback, surface);
  return { fill, onLight: isLight(fill) };
}

export const RETRY_GLYPH_CONTRAST = 3;

export type VaultRetryInk = { glyph: string; disc: string | null };

export function touchRetryInk(fill: string | null, destructive: string): VaultRetryInk {
  if (!fill || contrast(destructive, fill) >= RETRY_GLYPH_CONTRAST) return { glyph: destructive, disc: null };
  return { glyph: HIGHLIGHT_PUSH.lighter, disc: destructive };
}
