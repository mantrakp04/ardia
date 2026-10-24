export const PINCH_OPEN_AT = 0.3;
export const PINCH_CLOSE_AT = -0.25;
const SPREAD_TO_TAB = 0.4;

export type PinchOutcome = "open" | "close" | "stay";

export function pinchOutcome(magnification: number): PinchOutcome {
  if (magnification >= PINCH_OPEN_AT) return "open";
  if (magnification <= PINCH_CLOSE_AT) return "close";
  return "stay";
}

export function pinchFollow(magnification: number, startScale: number): { progress: number; expand: number } {
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  if (magnification >= 0) return { progress: 1, expand: clamp(magnification / SPREAD_TO_TAB) };
  return { progress: clamp((1 + magnification - startScale) / (1 - startScale)), expand: 0 };
}
