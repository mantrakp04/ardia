import { curve, spring } from "../ui/motion";

export const PEEK_SCRIM = { dark: "rgba(0,0,0,0.45)", light: "rgba(0,0,0,0.25)" } as const;

export const PEEK_MOTION = {
  grow: spring({ response: 0.22, damping: 0.9 }),
  fadeIn: { duration: 150, easing: curve.outQuad },
  close: { duration: 150, easing: curve.inCubic },
  expand: { duration: 170, easing: curve.outCubic },
} as const;
