import { useTheme } from "../ui/theme";
import { ink, shadow, weight } from "../ui/tokens";

const dark = {
  cardFill: "#FFFFFF17",
  cardBorder: "#FFFFFF0A",
  cardShadowOpacity: 0.3,
  title: "rgba(255,255,255,0.8)",
  body: "rgba(255,255,255,0.6)",
  arrow: "#FFFFFF99",
  badge: "#FFFFFF14",
  badgeGlyph: "#FFFFFFCC",
  askFill: "#FFFFFF17",
  askFillHover: "#FFFFFF24",
  askFillPressed: "#FFFFFF2E",
  askText: "rgba(255,255,255,0.85)",
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
  askFill: "#0000000D",
  askFillHover: "#00000017",
  askFillPressed: "#0000001F",
  askText: "rgba(0,0,0,0.8)",
  postcardTooltip: "rgba(0,0,0,0.8)",
  releaseNotesScrim: "rgba(255,255,255,0.35)",
};

export function useNtpColors(): NtpColors {
  return useTheme().dark ? dark : light;
}

export type NtpShadow = { color: string; opacity: number; radius: number; offset: [number, number] };

export const NTP_CARD = { border: 1, shadow: { color: shadow.dialog.color, radius: shadow.dialog.radius, offset: shadow.dialog.offset } } as const;

export const NTP_BAR: { radius: number; border: number; shadows: NtpShadow[] } = {
  radius: 20,
  border: 0.5,
  shadows: [
    { color: ink.black, opacity: 0.08, radius: 2, offset: [0, 0.5] },
    { color: ink.black, opacity: 0.04, radius: 1, offset: [0, 2] },
  ],
};

export const PERSONALIZE_PANEL = { radius: 16, spring: { friction: 9, tension: 90 } } as const;

export const ntpType = {
  incognitoTitle: { fontSize: 30, fontWeight: weight.bold, letterSpacing: -0.4 },
  personalizeTitle: { fontSize: 15, fontWeight: weight.semibold },
  releaseDate: { fontSize: 11, fontWeight: weight.semibold, letterSpacing: 1.2 },
  releaseTitle: { fontSize: 26, fontWeight: "300", letterSpacing: -0.5 },
  releaseItemBody: { fontSize: 12.5, lineHeight: 18 },
  artworkVersion: { fontSize: 11.5, fontWeight: weight.bold, letterSpacing: 1.4 },
  artworkTitle: { fontWeight: "300", fontStyle: "italic", letterSpacing: -1.1 },
  stamp: { fontSize: 6.5, fontWeight: weight.bold, letterSpacing: 0.6 },
} as const;

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
  closeShadow: { color: ink.black, opacity: 0.2, radius: 6, offset: [0, 2] } as NtpShadow,
  pageSpring: { friction: 9, tension: 55 },
  dropSpring: { response: 0.65, damping: 1 },
  tooltipIn: 50,
  pageClose: 240,
};
