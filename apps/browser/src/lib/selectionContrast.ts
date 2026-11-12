import { over, parseColor, toHex } from "./color";
import { oklab } from "./profileLook";

export const MIN_SELECTION_LIGHTNESS = 0.06;

const ALPHA_STEP = 0.01;
const MAX_FALLBACK_ALPHA = 0.5;

function lightness(color: string): number {
  const [r, g, b] = parseColor(color);
  return oklab({ r: r / 255, g: g / 255, b: b / 255, a: 1 })[0];
}

export function selectionLightnessDelta(fill: string, backdrops: readonly string[]): number {
  return Math.min(...backdrops.map((backdrop) => Math.abs(lightness(over(fill, backdrop)) - lightness(backdrop))));
}

const overlayAt = (color: string, alpha: number) => {
  const [r, g, b] = parseColor(color);
  return toHex([r, g, b, Math.round(alpha * 100) * 2.55]);
};

export function visibleSelection(fill: string, fallback: string, backdrops: readonly string[]): string {
  const passes = (color: string) => selectionLightnessDelta(color, backdrops) >= MIN_SELECTION_LIGHTNESS;
  if (!backdrops.length || passes(fill)) return fill;
  for (let alpha = ALPHA_STEP; alpha <= MAX_FALLBACK_ALPHA + 1e-9; alpha += ALPHA_STEP) {
    const shown = overlayAt(fallback, alpha);
    if (passes(shown)) return shown;
  }
  return overlayAt(fallback, MAX_FALLBACK_ALPHA);
}
