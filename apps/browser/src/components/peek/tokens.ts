import { curve, duration, springs } from "../ui/motion";

export const PEEK_SCRIM = { dark: "rgba(0,0,0,0.45)", light: "rgba(0,0,0,0.25)" } as const;

export const PEEK_MOTION = {
  grow: springs.snappy,
  fadeIn: { duration: duration.base, easing: curve.enter },
  close: { duration: duration.base, easing: curve.exit },
  expand: { duration: duration.base, easing: curve.enter },
} as const;
