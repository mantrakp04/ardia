import { StyleSheet } from "react-native";
import { useTheme } from "../ui/theme";
import { duration, springs } from "../ui/motion";
import { display, font, ink, proseLineHeight, radius, tracking, weight } from "../ui/tokens";

const dark = {
  cardFill: "#FFFFFF17",
  cardBorder: "#FFFFFF0A",
  cardShadowOpacity: 0.3,
  title: "rgba(255,255,255,0.8)",
  body: "rgba(255,255,255,0.6)",
  arrow: "#FFFFFF99",
  badge: "#FFFFFF14",
  badgeGlyph: "#FFFFFFCC",
  postcardTooltip: "rgba(255,255,255,0.18)",
  releaseNotesScrim: "rgba(10,10,10,0.35)",
};

export type NtpColors = typeof dark;

const light: NtpColors = {
  cardFill: "#FFFFFF80",
  cardBorder: "#00000014",
  cardShadowOpacity: 0.1,
  title: "rgba(0,0,0,0.8)",
  body: "rgba(0,0,0,0.53)",
  arrow: "#00000087",
  badge: "#0000000A",
  badgeGlyph: "#000000B3",
  postcardTooltip: "rgba(0,0,0,0.8)",
  releaseNotesScrim: "rgba(255,255,255,0.35)",
};

export function useNtpColors(): NtpColors {
  return useTheme().dark ? dark : light;
}

export type NtpShadow = { color: string; opacity: number; radius: number; offset: [number, number] };

export const NTP_CARD = { border: 1 } as const;

export const NTP_BAR: { radius: number; border: number; contentInset: number; shadows: NtpShadow[] } = {
  radius: 20,
  border: StyleSheet.hairlineWidth,
  contentInset: 0.5,
  shadows: [
    { color: ink.black, opacity: 0.08, radius: 2, offset: [0, 0.5] },
    { color: ink.black, opacity: 0.04, radius: 1, offset: [0, 2] },
  ],
};

export const PERSONALIZE_PANEL = { radius: radius.sheet, spring: springs.smooth } as const;

export const ntpType = {
  incognitoTitle: { ...display.large, fontWeight: weight.bold },
  releaseDate: { ...font.caption, fontWeight: weight.semibold, letterSpacing: tracking.wide },
  releaseTitle: { ...display.large, fontWeight: "300" },
  releaseItemBody: { ...font.small, lineHeight: proseLineHeight.small },
  artworkVersion: { ...font.caption, fontWeight: weight.bold, letterSpacing: tracking.wide },
  artworkTitle: { fontWeight: "300", fontStyle: "italic", letterSpacing: tracking.tight },
} as const;

export const postageStamp = { drawnRing: 80, drawnStroke: 1.6, frameStroke: 1.5 } as const;

export const postcard = {
  paper: "#FCFCFA",
  ink: "#1D1B1A",
  inkTertiary: "#1D1B1A80",
  inkSecondary: "#1D1B1AB3",
  inkBody: "#1D1B1A99",
  inkRule: "#1D1B1A14",
  inkStampBorder: "#1D1B1A33",
  inkStampRing: "#1D1B1A59",
  paperBorder: "#00000014",
  stampFill: ink.white,
  tooltipText: "rgba(255,255,255,0.85)",
  artworkVersion: "#FFFFFFCC",
  artworkTitle: ink.white,
  artworkLight: ink.white,
  artworkDark: "#10121A",
  cardShadow: { color: ink.black, opacity: 0.3, radius: 20, offset: [0, -6] } as NtpShadow,
  pageShadow: { color: ink.black, opacity: 0.3, radius: 40, offset: [0, 18] } as NtpShadow,
  pageSpring: springs.smooth,
  dropSpring: springs.smooth,
  tooltipIn: duration.fast,
  pageClose: duration.slow,
};
