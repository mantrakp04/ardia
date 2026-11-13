import { duration } from "../ui/motion";

export const GLYPH = 13;

export const TOOLBAR_MOTION = { dim: duration.base, progress: duration.base, hide: duration.base, show: duration.base, settle: 0 } as const;

export const RELOAD_BUTTON_MOTION = {
  stateIn: duration.base,
  stateOut: duration.slow,
  breatheCycle: 1420,
  pressScale: 0.76,
  hiddenScale: 0.72,
  breatheScale: [0.96, 1.06],
  breatheOpacity: [0.86, 1],
  returnRotation: 28,
} as const;

export const HISTORY_BUTTON_MOTION = {
  duration: duration.slow + 50,
  incomingDelay: 35,
  travel: 4,
} as const;
