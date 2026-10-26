import { curve } from "../ui/motion";
import { ink, type ShadowLevel } from "../ui/tokens";

const DARK = {
  emptyStateFill: "rgba(34,32,33,0.92)",
  zoneRest: "rgba(255,255,255,0.6)",
  zoneBorder: "rgba(255,255,255,0.08)",
  zoneFill: "rgba(255,236,214,0.04)",
  zoneDash: "rgba(255,255,255,0.1)",
  toastFill: "rgba(44,42,43,0.9)",
  toastBorder: "rgba(255,255,255,0.14)",
};

const LIGHT: typeof DARK = {
  emptyStateFill: "rgba(255,255,255,0.92)",
  zoneRest: "rgba(0,0,0,0.55)",
  zoneBorder: "rgba(0,0,0,0.08)",
  zoneFill: "rgba(255,255,255,0.45)",
  zoneDash: "rgba(0,0,0,0.1)",
  toastFill: "rgba(255,255,255,0.92)",
  toastBorder: "rgba(0,0,0,0.1)",
};

export type SplitColors = typeof DARK;

export const splitColors = (dark: boolean): SplitColors => (dark ? DARK : LIGHT);

export const ZONE_ACCENT_ALPHA = { dark: 0.16, light: 0.12 } as const;

export const SPLIT_SHADOWS = {
  emptyState: { color: ink.black, opacity: { dark: 0.3, light: 0.08 }, radius: 16, offset: [0, 6] },
  toast: { color: ink.black, opacity: { dark: 0.4, light: 0.14 }, radius: 16, offset: [0, 6] },
} satisfies Record<string, ShadowLevel>;

export const EMPTY_STATE_RADIUS = 16;
export const SPLIT_ROW_RADIUS = 9;
export const ZONE_RADIUS = 20;
export const ZONE_DASH_RADIUS = 11;

export const ZONE_SLIDE_MS = 110;

export const SPLIT_MOTION = {
  zoneGlow: { duration: 120, easing: curve.outQuad },
  zoneIn: { duration: ZONE_SLIDE_MS, easing: curve.outCubic },
  zoneOut: { duration: ZONE_SLIDE_MS, easing: curve.inQuad },
  zoneSpring: { stiffness: 987, damping: 56.5, mass: 1 },
  toastIn: { speed: 18, bounciness: 6 },
  toastOut: { duration: 220, easing: curve.inQuad },
} as const;
