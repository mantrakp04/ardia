import { useTheme } from "../ui/theme";
import { font, lineHeight, tracking } from "../ui/tokens";

const DARK = {
  tile: "rgba(255,255,255,0.07)",
  tileHover: "rgba(255,255,255,0.11)",
  tilePressed: "rgba(255,255,255,0.16)",
  tileStroke: "rgba(255,255,255,0.08)",
  iconTile: "rgba(255,255,255,0.1)",
  well: "rgba(255,255,255,0.06)",
  certificateWell: "rgba(255,255,255,0.05)",
};

export type SiteTokens = typeof DARK;

const LIGHT: SiteTokens = {
  tile: "rgba(0,0,0,0.0525)",
  tileHover: "rgba(0,0,0,0.0825)",
  tilePressed: "rgba(0,0,0,0.12)",
  tileStroke: "rgba(0,0,0,0.06)",
  iconTile: "rgba(0,0,0,0.06)",
  well: "rgba(0,0,0,0.04)",
  certificateWell: "rgba(0,0,0,0.04)",
};

export function useSiteTokens(): SiteTokens {
  return useTheme().dark ? DARK : LIGHT;
}

export const connectionColor = { caution: "#F2B33D" } as const;

export const CARD_BADGES = {
  visa: { label: "VISA", fill: "#1A1F71" },
  mastercard: { label: "", fill: "#1C1C1E" },
  amex: { label: "AMEX", fill: "#2E77BC" },
  discover: { label: "DISC", fill: "#FF6000" },
  diners: { label: "DC", fill: "#0079BE" },
  jcb: { label: "JCB", fill: "#0B7A3E" },
  unionpay: { label: "UP", fill: "#D7282F" },
  card: { label: "", fill: "#8E8E93" },
} as const;

export const MASTERCARD_RINGS = { left: "#EB001B", right: "#F79E1B" } as const;

export const cardBadgeType = { long: font.badge, short: font.badge, weight: "800", letterSpacing: tracking.caps } as const;

export const noticeType = font.small;

export const siteLine = { checkLabel: lineHeight.body } as const;

export const selectionBar = { showDelay: 150 } as const;

export const UNAVAILABLE_OPACITY = 0.4;
