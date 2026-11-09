import { over, parseColor, toHex } from "./color";
import { oklab } from "./profileLook";

export const MIN_SELECTION_LIGHTNESS = 0.03;
export const MIN_FLIPPED_SELECTION_LIGHTNESS = 0.06;

const ALPHA_STEP = 0.01;
const MAX_FILL_ALPHA = 0.85;
const MAX_FLIPPED_ALPHA = 0.5;

function lightness(color: string): number {
  const [r, g, b] = parseColor(color);
  return oklab({ r: r / 255, g: g / 255, b: b / 255, a: 1 })[0];
}

export function selectionLightnessDelta(fill: string, backdrops: readonly string[]): number {
  return Math.min(...backdrops.map((backdrop) => Math.abs(lightness(over(fill, backdrop)) - lightness(backdrop))));
}

const atAlpha = (color: string, alpha: number) => {
  const [r, g, b] = parseColor(color);
  return toHex([r, g, b, Math.round(alpha * 100) * 2.55]);
};

export function visibleSelection(fill: string, flipped: string, backdrops: readonly string[]): string {
  const passes = (color: string, floor: number) => selectionLightnessDelta(color, backdrops) >= floor;
  if (!backdrops.length || passes(fill, MIN_SELECTION_LIGHTNESS)) return fill;
  for (let alpha = parseColor(fill)[3] + ALPHA_STEP; alpha <= MAX_FILL_ALPHA + 1e-9; alpha += ALPHA_STEP) {
    const stronger = atAlpha(fill, alpha);
    if (passes(stronger, MIN_SELECTION_LIGHTNESS)) return stronger;
  }
  for (let alpha = ALPHA_STEP; alpha <= MAX_FLIPPED_ALPHA + 1e-9; alpha += ALPHA_STEP) {
    const lifted = atAlpha(flipped, alpha);
    if (passes(lifted, MIN_FLIPPED_SELECTION_LIGHTNESS)) return lifted;
  }
  return atAlpha(flipped, MAX_FLIPPED_ALPHA);
}
