import { duration, springs } from "../ui/motion";
import { display, proseLineHeight, radius, space } from "../ui/tokens";

export const importColors = {
  windowFill: { dark: "#1E1E1E", light: "#F4F4F4" },
  monogramFallback: "#8E8E93",
} as const;

export const importType = { heading: display.title, done: display.title, emoji: 15, bodyLine: proseLineHeight.body, smallLine: proseLineHeight.small } as const;

export const importLayout = {
  dragRegion: 40,
  padX: space.huge,
  padTop: 46,
  browserRow: 52,
  categoryRow: 44,
  avatar: 28,
  spaceIconRadius: radius.tile,
  appIcon: 56,
  safariIcon: 40,
  stepBadge: 20,
  dropHeight: 130,
  textMax: 420,
  loadingTop: 80,
  doneTop: 40,
} as const;

export const importMotion = {
  rowAppear: { duration: duration.slow, stagger: 70, rise: 8 },
  doneDelay: 700,
  check: springs.bouncy,
  success: { spring: springs.bouncy, from: 0.4 },
} as const;
