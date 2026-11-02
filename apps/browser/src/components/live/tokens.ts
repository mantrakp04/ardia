import { useTheme, type Theme } from "../ui/theme";
import { duration, period, springs } from "../ui/motion";
import { font, ink, proseLineHeight, weight } from "../ui/tokens";

const DARK = {
  pending: "#D29922",
  merged: "#A371F7",
  draft: "#8B949E",
  conflict: "#DB6D28",
  ciTrack: "rgba(255,255,255,0.1)",
  chip: "rgba(255,255,255,0.1)",
  badgeRing: "rgba(0,0,0,0.35)",
  avatarFill: "#4A4A4F",
};

const LIGHT: typeof DARK = {
  pending: "#9A6700",
  merged: "#8250DF",
  draft: "#6E7781",
  conflict: "#BC4C00",
  ciTrack: "rgba(0,0,0,0.08)",
  chip: "rgba(0,0,0,0.06)",
  badgeRing: "rgba(255,255,255,0.8)",
  avatarFill: "#D5D5DA",
};

export type LiveColors = typeof DARK & { success: string; failure: string; now: string };

const liveColors = new WeakMap<Theme, LiveColors>();

export function useLiveColors(): LiveColors {
  const theme = useTheme();
  let colors = liveColors.get(theme);
  if (!colors) liveColors.set(theme, (colors = { ...(theme.dark ? DARK : LIGHT), success: theme.success, failure: theme.destructive, now: theme.destructive }));
  return colors;
}

export const LIVE_NOW_TEXT = ink.white;

export const liveMotion = {
  badgeSpring: springs.bouncy,
  badgeHideSpring: springs.snappy,
  alertSpring: springs.bouncy,
  ciPulse: period.pulse,
  wiggle: [
    { to: 1, duration: duration.fast },
    { to: -1, duration: duration.fast },
    { to: 0.8, duration: duration.fast },
    { to: -0.6, duration: duration.fast },
    { to: 0.3, duration: duration.fast },
    { to: 0, duration: duration.fast },
  ],
};

export const liveType = {
  heading: { ...font.body, lineHeight: proseLineHeight.body, fontWeight: weight.semibold },
  detail: { ...font.small, lineHeight: proseLineHeight.small },
  empty: font.small,
  more: font.tiny,
  avatarScale: 0.42,
};
