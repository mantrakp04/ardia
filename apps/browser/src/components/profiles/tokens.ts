export const profileColors = {
  stackRing: { dark: "rgba(0,0,0,0.35)", light: "#FFFFFF" },
  badgeEdge: "rgba(0,0,0,0.12)",
  unknownSwatch: "#888888",
} as const;

export const SHARE_ROW_HEIGHT = 32;

export const profileSwitcher = {
  height: 41,
  band: 28,
  dotCell: 12,
  dot: 6,
  iconCell: 18,
  icon: 11,
  dotTooltipLift: 18.25,
  dots: { selected: 0.85, hovered: 0.4, idle: 0.2 },
  icons: { selected: 1, hovered: 0.7, idle: 0.42 },
} as const;
