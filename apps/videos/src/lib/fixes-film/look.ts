import type { CSSProperties } from "react";
import { interpolate } from "remotion";
import { color, font } from "../ac-launch/theme";

export const FPS = 60;
export const INTRO = Math.round(2.6 * FPS);
export const CARD = Math.round(1.4 * FPS);
export const HOLD_IN = Math.round(0.5 * FPS);
export const HOLD_OUT = Math.round(1.0 * FPS);
export const OUTRO = Math.round(2.4 * FPS);

export const label: CSSProperties = {
  fontFamily: font.mono,
  fontWeight: 460,
  fontStretch: "87.5%",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontSize: 20,
  color: color.ink2,
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function shownBetween(t: number, from: number, until: number | undefined) {
  if (t < from) return 0;
  const appear = interpolate(t, [from, from + 0.04], [0, 1], clamp);
  return until === undefined ? appear : appear * interpolate(t, [until, until + 0.15], [1, 0], clamp);
}
