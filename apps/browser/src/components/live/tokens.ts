import { useTheme } from "../ui/theme";
import { colorRoles, ink, weight, type ShadowLevel } from "../ui/tokens";

const DARK = {
  success: colorRoles.dark.success,
  failure: colorRoles.dark.destructive,
  pending: "#D29922",
  merged: "#A371F7",
  draft: "#8B949E",
  conflict: "#DB6D28",
  now: colorRoles.dark.destructive,
  ciTrack: "rgba(255,255,255,0.1)",
  chip: "rgba(255,255,255,0.1)",
  badgeRing: "rgba(0,0,0,0.35)",
  avatarFill: "#4A4A4F",
};

const LIGHT: typeof DARK = {
  success: colorRoles.light.success,
  failure: colorRoles.light.destructive,
  pending: "#9A6700",
  merged: "#8250DF",
  draft: "#6E7781",
  conflict: "#BC4C00",
  now: colorRoles.light.destructive,
  ciTrack: "rgba(0,0,0,0.08)",
  chip: "rgba(0,0,0,0.06)",
  badgeRing: "rgba(255,255,255,0.8)",
  avatarFill: "#D5D5DA",
};

export type LiveColors = typeof DARK;

export function useLiveColors(): LiveColors {
  return useTheme().dark ? DARK : LIGHT;
}

export const LIVE_NOW_TEXT = ink.white;

const panelShadowShare = (share: number) => ({ dark: colorRoles.dark.panelShadowOpacity * share, light: colorRoles.light.panelShadowOpacity * share });

export const liveShadow = {
  hoverCard: { color: ink.black, opacity: panelShadowShare(0.8), radius: 16, offset: [0, 6] },
  alert: { color: ink.black, opacity: panelShadowShare(1), radius: 20, offset: [0, 8] },
} satisfies Record<string, ShadowLevel>;

export const liveMotion = {
  badgeSpring: { speed: 16, bounciness: 10 },
  alertSpring: { speed: 14, bounciness: 6 },
  ciPulse: 700,
  wiggle: [
    { to: 1, duration: 70 },
    { to: -1, duration: 110 },
    { to: 0.8, duration: 110 },
    { to: -0.6, duration: 110 },
    { to: 0.3, duration: 100 },
    { to: 0, duration: 90 },
  ],
};

export const liveType = {
  heading: { fontSize: 13.5, lineHeight: 18, fontWeight: weight.semibold },
  detail: { fontSize: 12.5, lineHeight: 17 },
  empty: { fontSize: 12.5 },
  chip: { fontSize: 10.5, fontWeight: weight.medium },
  more: { fontSize: 10.5 },
  badge: { fontSize: 9, fontWeight: weight.bold, fontVariant: ["tabular-nums"] as "tabular-nums"[] },
  avatarScale: 0.42,
};
