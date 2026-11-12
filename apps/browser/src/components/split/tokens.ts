import { curve, duration, springs } from "../ui/motion";
import { concentric, radius } from "../ui/tokens";

const DARK = {
  emptyStateFill: "rgba(34,32,33,0.92)",
  zoneRest: "rgba(255,255,255,0.6)",
  zoneBorder: "rgba(255,255,255,0.08)",
  zoneFill: "rgba(255,236,214,0.04)",
  zoneDash: "rgba(255,255,255,0.1)",
};

const LIGHT: typeof DARK = {
  emptyStateFill: "rgba(255,255,255,0.92)",
  zoneRest: "rgba(0,0,0,0.55)",
  zoneBorder: "rgba(0,0,0,0.08)",
  zoneFill: "rgba(255,255,255,0.45)",
  zoneDash: "rgba(0,0,0,0.1)",
};

export type SplitColors = typeof DARK;

export const splitColors = (dark: boolean): SplitColors => (dark ? DARK : LIGHT);

export const ZONE_ACCENT_ALPHA = { dark: 0.16, light: 0.12 } as const;

export const EMPTY_STATE_RADIUS = radius.sheet;
export const EMPTY_STATE_WIDTH = 420;
export const SPLIT_ROW_HEIGHT = 36;
export const SPLIT_ROW_RADIUS = radius.chrome;
export const ZONE_RADIUS = radius.hero;
export const ZONE_DASH_INSET = 9.5;
export const ZONE_DASH_RADIUS = concentric(radius.hero, ZONE_DASH_INSET);

export const ZONE_SLIDE_MS = 110;

export const SPLIT_MOTION = {
  zoneGlow: { duration: duration.fast, easing: curve.enter },
  zoneIn: { duration: ZONE_SLIDE_MS, easing: curve.enter },
  zoneOut: { duration: ZONE_SLIDE_MS, easing: curve.exit },
  zoneSpring: springs.snappy,
} as const;

export const TOAST_MS = 2600;
export const TOAST_ACTION_MS = 4000;
