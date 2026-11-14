import { withOpacity } from "./color";

export const SHADOW_BLUR_PER_RADIUS = 2;
export const MOST_SHADOW_RINGS = 10;
const REACH_IN_DEVIATIONS = 2.5;

export type ShadowSpec = { color: string; opacity: number; blur: number; x: number; y: number };
export type Edges = { top: number; left: number; right: number; bottom: number };
export type ShadowLayer = Edges & { position: "absolute"; borderRadius: number; borderWidth?: number; borderColor?: string; backgroundColor?: string };

const finiteOr = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export function shadowSpec(color: unknown, opacity: unknown, radius: unknown, x: unknown, y: unknown): ShadowSpec | null {
  const alpha = Math.min(1, finiteOr(opacity, 0));
  if (typeof color !== "string" || !color || !(alpha > 0)) return null;
  return { color, opacity: alpha, blur: Math.max(0, finiteOr(radius, 0)) * SHADOW_BLUR_PER_RADIUS, x: finiteOr(x, 0), y: finiteOr(y, 0) };
}

function erfc(value: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(value));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const result = poly * Math.exp(-value * value);
  return value >= 0 ? result : 2 - result;
}

export function shadowIntensityOutside(distance: number, deviation: number): number {
  return 0.5 * erfc(distance / (deviation * Math.SQRT2));
}

export function shadowReach(blur: number): number {
  return (blur / 2) * REACH_IN_DEVIATIONS;
}

export function shadowRingCount(blur: number): number {
  return Math.max(1, Math.min(MOST_SHADOW_RINGS, Math.ceil(shadowReach(blur))));
}

export function shadowLayers(spec: ShadowSpec, cornerRadius: number, around: Edges = { top: 0, left: 0, right: 0, bottom: 0 }): ShadowLayer[] {
  const corner = Math.max(0, cornerRadius);
  const box = (outset: number): Edges => ({
    top: around.top - outset + spec.y,
    left: around.left - outset + spec.x,
    right: around.right - outset - spec.x,
    bottom: around.bottom - outset - spec.y,
  });
  if (!(spec.blur > 0)) return [{ position: "absolute", ...box(0), borderRadius: corner, backgroundColor: withOpacity(spec.color, spec.opacity) ?? spec.color }];
  const deviation = spec.blur / 2;
  const count = shadowRingCount(spec.blur);
  const band = shadowReach(spec.blur) / count;
  const rings: ShadowLayer[] = [];
  for (let index = 0; index < count; index++) {
    const outer = band * (index + 1);
    const alpha = spec.opacity * shadowIntensityOutside(band * (index + 0.5), deviation);
    rings.push({ position: "absolute", ...box(outer), borderRadius: corner + outer, borderWidth: band, borderColor: withOpacity(spec.color, alpha) ?? spec.color });
  }
  return rings;
}
