import { useTheme } from "../ui/theme";

const DARK = {
  tile: "rgba(255,255,255,0.07)",
  tileHover: "rgba(255,255,255,0.11)",
  tilePressed: "rgba(255,255,255,0.16)",
  tileStroke: "rgba(255,255,255,0.08)",
  iconTile: "rgba(255,255,255,0.1)",
  well: "rgba(255,255,255,0.06)",
  certificateWell: "rgba(255,255,255,0.05)",
  stepper: "rgba(255,255,255,0.06)",
  optionSelected: "rgba(255,255,255,0.14)",
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
  stepper: "rgba(0,0,0,0.05)",
  optionSelected: "rgba(0,0,0,0.08)",
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

export const cardBadgeType = { long: { fontSize: 7.5 }, short: { fontSize: 8 }, weight: "800", letterSpacing: 0.3 } as const;

export const noticeType = { fontSize: 12.5 } as const;

export const siteLine = { section: 15, checkLabel: 16 } as const;

export const selectionBar = { radius: 10, shadowRadius: 14, shadowOffset: [0, 6] as [number, number], showDelay: 150 } as const;

export const UNAVAILABLE_OPACITY = 0.4;
